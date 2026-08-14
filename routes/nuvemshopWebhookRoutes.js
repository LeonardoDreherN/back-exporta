const express = require('express');
const router = express.Router();

const db = require('../models');
const { importPedidosInternal } = require('../controller/PedidoImportController');
const { logSync } = require('../services/syncLog');

const API_BASE = 'https://api.nuvemshop.com.br/v1';
const USER_AGENT = 'Intrex (contato@exportadigital.com)';

// POST /nuvemshop/webhooks/orders-create
// Nuvemshop chama aqui quando um pedido é criado (evento "order/created", registrado
// automaticamente no /nuvemshop/callback). Busca o pedido completo na API (o payload do
// webhook em si só traz {store_id, event, id}) e importa pelo mesmo pipeline já usado
// pro Shopify — guardando nuvemshop_order_id/nuvemshop_fulfillment_order_id pra permitir
// empurrar atualização de status de volta depois (ver services/nuvemshop/fulfillment.js).
router.post('/orders-create', async (req, res) => {
    const start = Date.now();
    try {
        const payload = req.body || {};
        const storeId = String(payload.store_id || '');
        const orderId = payload.id;

        console.log('[NS ORDER WEBHOOK] recebido:', payload);

        if (!storeId || !orderId) {
            return res.status(400).send('payload incompleto');
        }

        const info = await db.InfoNuvemshop.findOne({
            where: { storeId },
            attributes: ['id_cliente'],
            raw: true,
        });
        if (!info?.id_cliente) {
            console.error('[NS ORDER WEBHOOK] cliente não vinculado à loja', storeId);
            return res.status(404).send('cliente nao vinculado');
        }

        const shopRow = await db.NuvemshopShop.findOne({
            where: { storeId },
            attributes: ['accessToken'],
            raw: true,
        });
        if (!shopRow?.accessToken) {
            console.error('[NS ORDER WEBHOOK] token ausente pra loja', storeId);
            return res.status(404).send('token ausente');
        }

        const resp = await fetch(
            `${API_BASE}/${storeId}/orders/${orderId}?aggregates=fulfillment_orders`,
            {
                headers: {
                    'Authentication': `bearer ${shopRow.accessToken}`,
                    'User-Agent': USER_AGENT,
                },
            }
        );
        if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            console.error('[NS ORDER WEBHOOK] falha ao buscar pedido', resp.status, body);
            return res.status(502).send('falha ao buscar pedido na Nuvemshop');
        }
        const order = await resp.json();

        const shipping = order.shipping_address || {};
        const numeroPedido = String(order.number || order.id || '').trim();
        const fulfillmentOrderId = (order.fulfillments || [])[0]?.id ?? null;

        const linhasImportacao = (order.products || []).map(item => ({
            id: numeroPedido,
            pedido_ref: numeroPedido,
            nuvemshop_order_id: order.id || null,
            nuvemshop_fulfillment_order_id: fulfillmentOrderId != null ? String(fulfillmentOrderId) : null,

            nome_completo: order.contact_name || shipping.name || order.billing_name || '',
            email: order.contact_email || '',
            telefone: order.contact_phone || shipping.phone || order.billing_phone || '',

            rua_e_numero: `${shipping.address || order.billing_address || ''}${shipping.number ? ', ' + shipping.number : ''}`,
            cidade: shipping.city || order.billing_city || '',
            estado_provincia: shipping.province || order.billing_province || '',
            cep: shipping.zipcode || order.billing_zipcode || '',
            pais: shipping.country || order.billing_country || '',

            moeda: order.currency || 'BRL',
            // sem valorTotal aqui de propósito: o agrupador soma valorTotalLinha de cada
            // item pra formar o total do pedido — setar o total do pedido em toda linha
            // fazia somar em dobro (ou mais, com >2 itens)

            titulo: item.name || '',
            quantidade: Number(item.quantity || 0),
            preco: Number(item.price || 0),
            sku: item.sku || '',
        }));

        const imported = await importPedidosInternal(info.id_cliente, linhasImportacao);

        console.log('[NS ORDER IMPORTED]', {
            storeId,
            clienteId: info.id_cliente,
            imported,
            pedido_ref: numeroPedido,
            fulfillmentOrderId,
        });

        await logSync({
            integration: 'nuvemshop',
            clienteId: info.id_cliente,
            status: 'ok',
            message: `Pedido ${numeroPedido} importado via webhook`,
            durationMs: Date.now() - start,
        });

        return res.status(200).send('ok');
    } catch (e) {
        console.error('[NS ORDER WEBHOOK ERROR]', e);
        await logSync({
            integration: 'nuvemshop',
            status: 'error',
            message: e?.message || String(e),
            durationMs: Date.now() - start,
        });
        return res.status(500).send('error');
    }
});

module.exports = router;
