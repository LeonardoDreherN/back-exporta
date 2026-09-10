// jobs/pollTracking.js
// Roda de hora em hora (agendado em server.js) e mantém o status das cotações
// em dia consultando a transportadora.
//
// Antes este job só falava com a UPS: pegava getLatestEvent do módulo da UPS,
// cujo getTimeline devolve [] para qualquer carrier != 'UPS'. Toda cotação
// FedEx caía no `if (!evt) continue` e era pulada, de hora em hora — e a FedEx
// é a maior parte da operação. O status dela no painel só avançava quando
// alguém abria a tela do envio e disparava uma consulta avulsa.
//
// Agora usa services/trackingStatus, que já despacha UPS e FEDEX e já era
// usado nesse mesmo formato em outro fluxo.
const { Cotacao, Sequelize } = require('../models');
const { getStatusOnly } = require('../services/trackingStatus');
const { logSync } = require('../services/syncLog');
const { pushTrackingEventNuvemshop } = require('../services/nuvemshop/fulfillment');

// Status que ainda podem mudar. EXCECAO estava de fora e isso congelava o
// envio: assim que a transportadora sinalizava um problema, o job parava de
// consultar aquele rastreio para sempre — mesmo depois de o pacote ser
// entregue. Havia envio marcado como excecao ha seis meses, com o ultimo
// evento gravado sendo "On the way".
const STATUS_EM_ANDAMENTO = [
    'CRIADO',
    'COLETADO',
    'EM_TRANSITO',
    'SAIU_PARA_ENTREGA',
    'EXCECAO',
];

// UPS e FedEx descartam o historico de rastreio depois de alguns meses: passar
// disso e gastar chamada para receber vazio, e ainda ocupa o teto de 200 por
// rodada que os envios recentes precisam.
const DIAS_MAX_RASTREIO = 90;

function dataValida(valor) {
    if (!valor) return null;
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? null : d;
}

async function pool() {
    const start = Date.now();
    const { Op } = Sequelize;
    const limiteIdade = new Date(Date.now() - DIAS_MAX_RASTREIO * 24 * 60 * 60 * 1000);

    const pendentes = await Cotacao.findAll({
        where: {
            status_norm: { [Op.in]: STATUS_EM_ANDAMENTO },
            tracking_number: { [Op.ne]: null },
            createdAt: { [Op.gte]: limiteIdade },
        },
        limit: 200,
    });

    let atualizados = 0;
    let mudancasDeStatus = 0;
    let erros = 0;
    const porCarrier = {};

    for (const c of pendentes) {
        const carrier = String(c.carrier || 'UPS').toUpperCase();
        try {
            const { status_norm: novo, last_event, raw } = await getStatusOnly({
                carrier,
                trackingNumber: c.tracking_number,
            });

            // Sem evento: a transportadora não devolveu nada. Não mexe — senão
            // rebaixaria para CRIADO um envio que já está em trânsito.
            if (!raw) continue;

            const eventTime = dataValida(last_event);
            const temEventoNovo = !!eventTime && (!c.last_tracking_at || eventTime > c.last_tracking_at);
            const mudouStatus = !!novo && novo !== c.status_norm;

            if (!temEventoNovo && !mudouStatus) continue;

            // last_tracking_at passa a acompanhar QUALQUER evento novo, não só
            // mudança de status. Antes, um pacote podia acumular eventos por dias
            // sem nada ser gravado, e o campo virava "última mudança de status" —
            // inútil para saber se um envio parou de andar.
            await c.update({
                ...(mudouStatus ? { status_norm: novo } : {}),
                ...(eventTime ? { last_tracking_at: eventTime } : {}),
                tracking_raw: raw,
            });

            atualizados += 1;
            porCarrier[carrier] = (porCarrier[carrier] || 0) + 1;

            if (mudouStatus) {
                mudancasDeStatus += 1;

                // Empurra o novo status pra Nuvemshop, se o pedido veio de lá — nunca
                // pode derrubar o polling dos outros pedidos se falhar. Só em mudança
                // de status: evento novo com mesmo status não interessa ao fulfillment.
                pushTrackingEventNuvemshop({
                    clienteId: c.cliente_id,
                    pedidoRef: c.pedido_ref,
                    statusNorm: novo,
                    trackingNumber: c.tracking_number,
                }).catch((e) => console.error('[NS FULFILLMENT PUSH] erro ao chamar', c.pedido_ref, e.message));
            }
        } catch (err) {
            erros += 1;
            console.error('pool tracking error', carrier, c.id, err?.message || err);
        }
    }

    const detalhe = Object.entries(porCarrier).map(([k, v]) => `${k}:${v}`).join(' ') || 'nenhuma';

    await logSync({
        integration: 'ups',
        status: erros > 0 ? 'error' : 'ok',
        message: `pollTracking: ${pendentes.length} verificadas, ${atualizados} atualizadas (${detalhe}), ${mudancasDeStatus} mudaram de status, ${erros} erros`,
        durationMs: Date.now() - start,
    });
}

module.exports = { pool };
