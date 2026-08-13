const db = require('../../models');

const API_BASE = 'https://api.nuvemshop.com.br/v1';
const USER_AGENT = 'Intrex (contato@exportadigital.com)';

// Mapeia o enum interno (Cotacao.status_norm) pro enum de tracking-event da Nuvemshop.
// EXCECAO usa 'failure' (evento genérico de falha) porque não temos detalhe suficiente
// pra diferenciar delivery_attempt_failed/delayed/lost.
const STATUS_MAP = {
    COLETADO: 'dispatched',
    EM_TRANSITO: 'in_transit',
    SAIU_PARA_ENTREGA: 'out_for_delivery',
    ENTREGUE: 'delivered',
    EXCECAO: 'failure',
    RETORNADO: 'returned_to_sender',
};

/**
 * Empurra um evento de rastreio pra Nuvemshop, pra mover o pedido pelos status
 * (Coletado -> Postado -> Em Trânsito -> Saiu pra Entrega -> Entregue) no admin dela.
 * Falha silenciosa se o pedido não veio da Nuvemshop (não tem PedidoImport vinculado)
 * ou se o status não tem mapeamento — não é erro, só não se aplica.
 */
async function pushTrackingEventNuvemshop({ clienteId, pedidoRef, statusNorm, trackingNumber }) {
    const evento = STATUS_MAP[statusNorm];
    if (!evento || !pedidoRef || !clienteId) return;

    try {
        const pedido = await db.PedidoImport.findOne({
            where: { cliente_id: clienteId, pedido_ref: String(pedidoRef) },
            attributes: ['nuvemshop_order_id', 'nuvemshop_fulfillment_order_id'],
            raw: true,
        });

        if (!pedido?.nuvemshop_order_id || !pedido?.nuvemshop_fulfillment_order_id) {
            return; // pedido não veio da Nuvemshop, nada a fazer
        }

        const infoRow = await db.InfoNuvemshop.findOne({
            where: { id_cliente: clienteId },
            attributes: ['storeId'],
            order: [['updatedAt', 'DESC']],
            raw: true,
        });
        if (!infoRow?.storeId) return;

        const shopRow = await db.NuvemshopShop.findOne({
            where: { storeId: infoRow.storeId },
            attributes: ['accessToken'],
            raw: true,
        });
        if (!shopRow?.accessToken) return;

        const url = `${API_BASE}/${infoRow.storeId}/orders/${pedido.nuvemshop_order_id}/fulfillment-orders/${pedido.nuvemshop_fulfillment_order_id}/tracking-events`;

        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Authentication': `bearer ${shopRow.accessToken}`,
                'User-Agent': USER_AGENT,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                status: evento,
                description: trackingNumber ? `Rastreio ${trackingNumber}` : 'Atualização de status Intrex',
                address: null,
                happened_at: new Date().toISOString(),
                estimated_delivery_at: null,
            }),
        });

        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            console.error('[NS FULFILLMENT PUSH] falha', resp.status, body);
            return;
        }

        console.log('[NS FULFILLMENT PUSH]', { pedidoRef, evento, orderId: pedido.nuvemshop_order_id });
    } catch (e) {
        console.error('[NS FULFILLMENT PUSH ERROR]', pedidoRef, e.message);
    }
}

module.exports = { pushTrackingEventNuvemshop, STATUS_MAP };
