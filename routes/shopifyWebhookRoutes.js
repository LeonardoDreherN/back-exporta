const express = require('express');
const router = express.Router();

const { importPedidosInternal } = require('../controller/PedidoImportController');
const db = require('../models');

router.post('/orders-create', async (req, res) => {
    try {
        const order = req.body || {};

        console.log('[SHOPIFY ORDER RECEIVED]', {
            id: order.id,
            name: order.name,
            email: order.email,
            total: order.total_price
        });

        const customer = order.customer || {};
        const shipping = order.shipping_address || {};
        const billing = order.billing_address || {};

        const shopDomain =
            req.headers['x-shopify-shop-domain'] ||
            req.headers['x-shop-domain'] ||
            null;

        if (!shopDomain) {
            console.error('[SHOPIFY WEBHOOK ERROR] shop domain não enviado no header');
            return res.status(400).send('missing shop domain');
        }

        const info = await db.InfoShopify.findOne({
            where: { shopDomain },
            attributes: ['id_cliente', 'shopDomain'],
            raw: true,
        });

        if (!info?.id_cliente) {
            console.error('[SHOPIFY WEBHOOK ERROR] cliente não vinculado à loja', shopDomain);
            return res.status(404).send('cliente nao vinculado');
        }

        const nomeCliente =
            `${customer.first_name || ''} ${customer.last_name || ''}`.trim() ||
            shipping.name ||
            billing.name ||
            order.email ||
            'Cliente Shopify';

        const telefoneCliente =
            shipping.phone ||
            billing.phone ||
            customer.phone ||
            '';

        const rua =
            shipping.address1 ||
            billing.address1 ||
            '';

        const complemento =
            shipping.address2 ||
            billing.address2 ||
            '';

        const cidade =
            shipping.city ||
            billing.city ||
            '';

        const estado =
            shipping.province_code ||
            shipping.province ||
            billing.province_code ||
            billing.province ||
            '';

        const pais =
            shipping.country_code ||
            shipping.country ||
            billing.country_code ||
            billing.country ||
            '';

        const cep =
            shipping.zip ||
            billing.zip ||
            '';

        const numeroPedido = String(order.name || order.order_number || order.id || '')
            .replace(/^#/, '')
            .trim();

        // IMPORTANTE:
        // o importPedidosInternal espera linhas "flat", uma por item, no estilo CSV
        const linhasImportacao = (order.line_items || []).map(item => ({
            id: numeroPedido,
            pedido_ref: numeroPedido,
            shopify_order_id: order.id || null,

            nome_completo: nomeCliente,
            email: customer.email || order.email || '',
            telefone: telefoneCliente,

            rua_e_numero: `${rua}${complemento ? ', ' + complemento : ''}`,
            cidade: cidade,
            estado_provincia: estado,
            cep: cep,
            pais: pais,

            moeda: order.currency || 'USD',
            valorTotal: Number(order.total_price || 0),

            titulo: item.name || '',
            quantidade: Number(item.quantity || 0),
            preco: Number(item.price || 0),
            sku: item.sku || '',
        }));

        console.log('[PEDIDO FORMATADO]', JSON.stringify(linhasImportacao, null, 2));

        const imported = await importPedidosInternal(info.id_cliente, linhasImportacao);

        console.log('[SHOPIFY ORDER IMPORTED]', {
            shopDomain,
            clienteId: info.id_cliente,
            imported,
            pedido_ref: numeroPedido,
        });

        return res.status(200).send('ok');
    } catch (e) {
        console.error('[SHOPIFY WEBHOOK ERROR]', e);
        return res.status(500).send('error');
    }
});

module.exports = router;