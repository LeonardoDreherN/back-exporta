const express = require('express');
const crypto = require('crypto');

const router = express.Router();

function verifyShopifyHmac(req) {
    const hmacHeader = req.get('x-shopify-hmac-sha256') || '';
    const rawBody = req.body;

    if (!hmacHeader || !rawBody) return false;

    const digest = crypto
        .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
        .update(rawBody)
        .digest('base64');

    try {
        return crypto.timingSafeEqual(
            Buffer.from(digest, 'utf8'),
            Buffer.from(hmacHeader, 'utf8')
        );
    } catch {
        return false;
    }
}

function parseJsonBody(req) {
    try {
        return JSON.parse(req.body.toString('utf8'));
    } catch {
        return null;
    }
}

function handleComplianceWebhook(req, res) {
    if (!verifyShopifyHmac(req)) {
        return res.status(401).send('Invalid HMAC');
    }

    const topic = req.get('x-shopify-topic') || '';
    const shop = req.get('x-shopify-shop-domain') || '';
    const payload = parseJsonBody(req);

    console.log('[SHOPIFY COMPLIANCE]', {
        topic,
        shop,
        payload,
    });

    return res.status(200).send('ok');
}

// Shopify pode entregar no endpoint base /shopify/webhooks
router.post('/', express.raw({ type: '*/*' }), handleComplianceWebhook);

// Compatibilidade com subrotas
router.post('/customers/data_request', express.raw({ type: '*/*' }), handleComplianceWebhook);
router.post('/customers/redact', express.raw({ type: '*/*' }), handleComplianceWebhook);
router.post('/shop/redact', express.raw({ type: '*/*' }), handleComplianceWebhook);

module.exports = router;