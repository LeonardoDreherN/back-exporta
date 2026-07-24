const db = require('../../models');
const { logSync } = require('../syncLog');
const { getValidAccessToken } = require('./oauth');

const TRACKING_URLS = {
    UPS: (n) => `https://www.ups.com/track?tracknum=${n}`,
    FEDEX: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
};

const API_VERSION = '2026-04';

async function shopifyGraphQL(shopDomain, accessToken, query, variables = {}) {
    const res = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Shopify GraphQL HTTP ${res.status}`);
    return res.json();
}

async function getFulfillmentOrderIds(shopDomain, accessToken, shopifyOrderId) {
    const gid = `gid://shopify/Order/${shopifyOrderId}`;
    const data = await shopifyGraphQL(shopDomain, accessToken, `
        query getFulfillmentOrders($id: ID!) {
            order(id: $id) {
                fulfillmentOrders(first: 10) {
                    nodes { id status }
                }
            }
        }
    `, { id: gid });

    const nodes = data?.data?.order?.fulfillmentOrders?.nodes || [];
    return nodes
        .filter(n => n.status === 'OPEN' || n.status === 'IN_PROGRESS')
        .map(n => n.id);
}

async function createFulfillment(shopDomain, accessToken, fulfillmentOrderIds, trackingNumber, carrier) {
    const trackingUrl = (TRACKING_URLS[carrier] || TRACKING_URLS.UPS)(trackingNumber);

    const data = await shopifyGraphQL(shopDomain, accessToken, `
        mutation fulfillmentCreateV2($fulfillment: FulfillmentV2Input!) {
            fulfillmentCreateV2(fulfillment: $fulfillment) {
                fulfillment {
                    id
                    status
                    trackingInfo { number url company }
                }
                userErrors { field message }
            }
        }
    `, {
        fulfillment: {
            lineItemsByFulfillmentOrder: fulfillmentOrderIds.map(id => ({ fulfillmentOrderId: id })),
            trackingInfo: {
                number: trackingNumber,
                url: trackingUrl,
                company: carrier === 'FEDEX' ? 'FedEx' : 'UPS',
            },
            notifyCustomer: true,
        },
    });

    const result = data?.data?.fulfillmentCreateV2;
    const userErrors = result?.userErrors || [];
    if (userErrors.length) {
        throw new Error(`Shopify fulfillment errors: ${userErrors.map(e => e.message).join(', ')}`);
    }
    return result?.fulfillment || null;
}

/**
 * Busca o pedido, encontra a loja e cria o fulfillment na Shopify automaticamente.
 * Falha silenciosa se o pedido não veio da Shopify.
 */
async function autoFulfillShopifyOrder({ clienteId, pedidoRef, trackingNumber, carrier }) {
    if (!trackingNumber || !pedidoRef || !clienteId) return;

    const start = Date.now();
    try {
        const pedido = await db.PedidoImport.findOne({
            where: { cliente_id: clienteId, pedido_ref: String(pedidoRef) },
            attributes: ['shopify_order_id'],
            raw: true,
        });

        if (!pedido?.shopify_order_id) {
            console.log(`[AUTO-FULFILL] Pedido ${pedidoRef} sem shopify_order_id, pulando.`);
            return;
        }

        const infoShopify = await db.InfoShopify.findOne({
            where: { id_cliente: clienteId },
            attributes: ['shopDomain'],
            raw: true,
        });

        if (!infoShopify?.shopDomain) {
            console.log(`[AUTO-FULFILL] Cliente ${clienteId} sem loja Shopify vinculada, pulando.`);
            return;
        }

        const accessToken = await getValidAccessToken(infoShopify.shopDomain);

        if (!accessToken) {
            console.warn(`[AUTO-FULFILL] Loja ${infoShopify.shopDomain} sem accessToken.`);
            return;
        }

        console.log(`[AUTO-FULFILL] usando shop=${infoShopify.shopDomain} token=${accessToken.slice(0,8)}...`);

        const fulfillmentOrderIds = await getFulfillmentOrderIds(
            infoShopify.shopDomain,
            accessToken,
            pedido.shopify_order_id
        );

        if (!fulfillmentOrderIds.length) {
            console.log(`[AUTO-FULFILL] Nenhum fulfillment order OPEN para pedido ${pedidoRef}.`);
            return;
        }

        const fulfillment = await createFulfillment(
            infoShopify.shopDomain,
            accessToken,
            fulfillmentOrderIds,
            trackingNumber,
            String(carrier).toUpperCase()
        );

        console.log(`[AUTO-FULFILL] Pedido ${pedidoRef} fulfillado na Shopify:`, fulfillment?.id);

        await logSync({
            integration: 'shopify',
            clienteId,
            status: 'ok',
            message: `Fulfillment automático criado para pedido ${pedidoRef}`,
            durationMs: Date.now() - start,
        });
    } catch (err) {
        console.error(`[AUTO-FULFILL] Falha ao fulfillr pedido ${pedidoRef}:`, err.message);
        await logSync({
            integration: 'shopify',
            clienteId,
            status: 'error',
            message: `Falha no fulfillment automático do pedido ${pedidoRef}: ${err.message}`,
            durationMs: Date.now() - start,
        });
    }
}

module.exports = { autoFulfillShopifyOrder };
