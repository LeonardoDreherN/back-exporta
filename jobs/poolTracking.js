// jobs/pollTracking.js
const { Cotacao, Sequelize } = require('../models');
const { normalize } = require('../services/ups/tracking');
const tracking = require('../services/ups/tracking'); // implemente getLatestEvent

async function poll() {
    const { Op } = Sequelize;
    const pendentes = await Cotacao.findAll({
        where: { status_norm: { [Op.in]: ['CRIADO', 'EM_TRANSITO'] }, tracking_number: { [Op.ne]: null } },
        limit: 200,
    });

    for (const c of pendentes) {
        try {
            const carrier = c.carrier || 'UPS'; // salve 'carrier' na cotação quando emitir
            const evt = await tracking.getLatestEvent(carrier, c.tracking_number);
            if (!evt) continue;

            const novo = normalize(carrier, evt);
            const eventTime = new Date(evt.eventTime || evt.dateTime || Date.now());
            const isNewer = !c.last_tracking_at || eventTime > c.last_tracking_at;

            if (isNewer || c.status_norm !== novo) {
                await c.update({
                    status_norm: novo,
                    last_tracking_at: eventTime,
                    tracking_raw: evt,
                });
            }
        } catch (err) {
            console.error('poll tracking error', c.id, err?.message || err);
        }
    }
}

module.exports = { poll };
