const express = require('express');
const router = express.Router();

router.post('/orders-create', async (req, res) => {
    try {
        const order = req.body;

        // 🔥 LOG LIMPO
        console.log('[SHOPIFY ORDER RECEIVED]', {
            id: order.id,
            name: order.name,
            email: order.email,
            total: order.total_price
        });

        const customer = order.customer || {};
        const shipping = order.shipping_address || {};

        const pedidoFormatado = {
            cliente_nome: `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
            cliente_email: customer.email || order.email,
            cliente_telefone: shipping.phone || customer.phone || null,

            endereco: {
                rua: shipping.address1,
                cidade: shipping.city,
                estado: shipping.province_code || shipping.province,
                pais: shipping.country_code,
                cep: shipping.zip,
            },

            itens: (order.line_items || []).map(item => ({
                nome: item.name,
                quantidade: item.quantity,
                valor: Number(item.price || 0)
            })),

            valor_total: Number(order.total_price || 0),
            origem: 'shopify',
            status: 'pendente',
            shopify_order_id: order.id
        };

        console.log('[PEDIDO FORMATADO]', JSON.stringify(pedidoFormatado, null, 2));

        // 👉 próximo passo: mandar para Intrex
        // await importPedidosInternal(...)

        return res.status(200).send('ok');
    } catch (e) {
        console.error('[SHOPIFY WEBHOOK ERROR]', e);
        return res.status(500).send('error');
    }
});

module.exports = router;