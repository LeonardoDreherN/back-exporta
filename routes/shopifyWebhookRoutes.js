const express = require('express');
const router = express.Router();

const { importPedidosInternal } = require('../controller/PedidoImportController');
const db = require('../models');
const { logSync } = require('../services/syncLog');
const { aplicarPrefixo } = require('../services/shopify/pedidoRef');

router.post('/orders-create', async (req, res) => {
    const start = Date.now();
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
            attributes: ['id_cliente', 'shopDomain', 'prefixoPedido'],
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

        const numeroPedidoLoja = String(order.name || order.order_number || order.id || '')
            .replace(/^#/, '')
            .trim();

        // A Shopify numera por loja: duas lojas do mesmo cliente chegam as duas
        // ao 1007. Com prefixo cadastrado, a ref nasce unica dentro do cliente.
        const numeroPedido = aplicarPrefixo(info.prefixoPedido, numeroPedidoLoja);

        // IMPORTANTE:
        // o importPedidosInternal espera linhas "flat", uma por item, no estilo CSV
        const linhasImportacao = (order.line_items || []).map(item => ({
            id: numeroPedido,
            pedido_ref: numeroPedido,
            shopify_order_id: order.id || null,
            shop_domain: shopDomain,

            nome_completo: nomeCliente,
            email: customer.email || order.email || '',
            telefone: telefoneCliente,

            rua_e_numero: `${rua}${complemento ? ', ' + complemento : ''}`,
            cidade: cidade,
            estado_provincia: estado,
            cep: cep,
            pais: pais,

            moeda: order.currency || 'USD',
            // sem valorTotal aqui de propósito: o agrupador soma valorTotalLinha de cada
            // item pra formar o total do pedido — setar o total do pedido em toda linha
            // fazia somar em dobro (ou mais, com >2 itens)

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

        // Nada criado e algo descartado: o pedido NAO entrou. Antes isso era
        // registrado como "importado via webhook" e o pedido desaparecia sem
        // ninguem perceber.
        const descartado = imported?.created === 0 && imported?.skipped > 0;

        if (descartado) {
            console.warn('[SHOPIFY ORDER SKIPPED]', {
                shopDomain,
                clienteId: info.id_cliente,
                pedido_ref: numeroPedido,
                motivo: 'ref ja existe para este cliente',
            });
        }

        await logSync({
            integration: 'shopify',
            clienteId: info.id_cliente,
            status: descartado ? 'error' : 'ok',
            message: descartado
                ? `Pedido ${numeroPedido} (loja ${shopDomain}) NAO importado: ja existe pedido com a ref ${numeroPedido} nesta conta. Se o cliente tem mais de uma loja, cadastre o prefixo de pedido da loja.`
                : `Pedido ${numeroPedido} importado via webhook`,
            durationMs: Date.now() - start,
        });

        // 200 mesmo no descarte: a Shopify reenviaria o mesmo pedido e o
        // resultado seria igual. O que faltava era o registro honesto acima.
        return res.status(200).send('ok');
    } catch (e) {
        console.error('[SHOPIFY WEBHOOK ERROR]', e);
        await logSync({
            integration: 'shopify',
            status: 'error',
            message: e?.message || String(e),
            durationMs: Date.now() - start,
        });
        return res.status(500).send('error');
    }
});

module.exports = router;