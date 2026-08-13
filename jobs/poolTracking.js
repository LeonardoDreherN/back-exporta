// jobs/pollTracking.js
const { Cotacao, Sequelize } = require('../models');
const { normalize } = require('../services/ups/tracking');
const tracking = require('../services/ups/tracking'); // implemente getLatestEvent
const { logSync } = require('../services/syncLog');
const { pushTrackingEventNuvemshop } = require('../services/nuvemshop/fulfillment');

async function pool() {
    const start = Date.now();
    const { Op } = Sequelize;
    const pendentes = await Cotacao.findAll({
        where: { status_norm: { [Op.in]: ['CRIADO', 'EM_TRANSITO'] }, tracking_number: { [Op.ne]: null } },
        limit: 200,
    });

    let atualizados = 0;
    let erros = 0;

    for (const c of pendentes) {
        try {
            const carrier = c.carrier || 'UPS'; // salve 'carrier' na cotação quando emitir
            const evt = await tracking.getLatestEvent(carrier, c.tracking_number);
            if (!evt) continue;

            const novo = normalize(carrier, evt);
            const eventTime = new Date(evt.eventTime || evt.dateTime || Date.now());
            const isNewer = !c.last_tracking_at || eventTime > c.last_tracking_at;

            if (isNewer && c.status_norm !== novo) {
                await c.update({
                    status_norm: novo,
                    last_tracking_at: eventTime,
                    tracking_raw: evt,
                });
                atualizados += 1;

                // Empurra o novo status pra Nuvemshop, se o pedido veio de lá — nunca
                // pode derrubar o polling dos outros pedidos se falhar
                pushTrackingEventNuvemshop({
                    clienteId: c.cliente_id,
                    pedidoRef: c.pedido_ref,
                    statusNorm: novo,
                    trackingNumber: c.tracking_number,
                }).catch((e) => console.error('[NS FULFILLMENT PUSH] erro ao chamar', c.pedido_ref, e.message));
            }
        } catch (err) {
            erros += 1;
            console.error('pool tracking error', c.id, err?.message || err);
        }
    }

    await logSync({
        integration: 'ups',
        status: erros > 0 ? 'error' : 'ok',
        message: `pollTracking: ${pendentes.length} verificadas, ${atualizados} atualizadas, ${erros} erros`,
        durationMs: Date.now() - start,
    });
}

module.exports = { pool };
