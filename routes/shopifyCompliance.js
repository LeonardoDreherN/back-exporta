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

router.post('/customers/data_request', express.raw({ type: '*/*' }), (req, res) => {
    if (!verifyShopifyHmac(req)) {
        return res.status(401).send('Invalid HMAC');
    }

    const payload = parseJsonBody(req);
    console.log('[GDPR] data_request', payload);

    return res.status(200).send('ok');
});

router.post('/customers/redact', express.raw({ type: '*/*' }), (req, res) => {
    if (!verifyShopifyHmac(req)) {
        return res.status(401).send('Invalid HMAC');
    }

    const payload = parseJsonBody(req);
    console.log('[GDPR] customers_redact', payload);

    return res.status(200).send('ok');
});

router.post('/shop/redact', express.raw({ type: '*/*' }), (req, res) => {
    if (!verifyShopifyHmac(req)) {
        return res.status(401).send('Invalid HMAC');
    }

    const payload = parseJsonBody(req);
    console.log('[GDPR] shop_redact', payload);

    return res.status(200).send('ok');
});

module.exports = router;