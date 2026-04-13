const { importPedidosInternal } = require('../controller/PedidoImportController');
const db = require('../models');

const express = require('express');
const router = express.Router();

const { importPedidosInternal } = require('../controller/PedidoImportController');
const db = require('../models');

router.post('/orders-create', async (req, res) => {
    try {
        const order = req.body;

        console.log('[SHOPIFY ORDER RECEIVED]', {
            id: order.id,
            name: order.name,
            email: order.email,
            total: order.total_price
        });

        const customer = order.customer || {};
        const shipping = order.shipping_address || {};

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

        const linhaImportacao = {
            pedido_ref: String(order.id),
            nomeComprador: `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || shipping.name || '',
            emailComprador: customer.email || order.email || '',
            telefoneComprador: shipping.phone || customer.phone || '',
            endereco: shipping.address1 || '',
            numero: '',
            complemento: shipping.address2 || '',
            cidade: shipping.city || '',
            estado: shipping.province_code || shipping.province || '',
            pais: shipping.country_code || '',
            CEP: shipping.zip || '',
            total: Number(order.total_price || 0),
            itens: (order.line_items || []).map(item => ({
                titulo: item.name || '',
                qty: Number(item.quantity || 0),
                preco: Number(item.price || 0),
            })),
            origem: 'shopify',
            status: 'pendente',
            shopify_order_id: order.id,
        };

        console.log('[PEDIDO FORMATADO]', JSON.stringify(linhaImportacao, null, 2));

        const imported = await importPedidosInternal(info.id_cliente, [linhaImportacao]);

        console.log('[SHOPIFY ORDER IMPORTED]', {
            shopDomain,
            clienteId: info.id_cliente,
            imported,
            pedido_ref: linhaImportacao.pedido_ref,
        });

        return res.status(200).send('ok');
    } catch (e) {
        console.error('[SHOPIFY WEBHOOK ERROR]', e);
        return res.status(500).send('error');
    }
});

module.exports = router;