// routes/shopifyCompliance.js

const express = require('express');
const crypto = require('crypto');

const router = express.Router();

function verifyShopifyHmac(req) {
    const hmacHeader = req.headers['x-shopify-hmac-sha256'];
    const body = JSON.stringify(req.body);

    const digest = crypto
        .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
        .update(body, 'utf8')
        .digest('base64');

    return digest === hmacHeader;
}

// CUSTOMER DATA REQUEST
router.post('/customers/data_request', (req, res) => {
    if (!verifyShopifyHmac(req)) {
        return res.status(401).send('Invalid HMAC');
    }

    console.log('[GDPR] data_request', req.body);

    res.status(200).send('ok');
});

// CUSTOMER REDACT
router.post('/customers/redact', (req, res) => {
    if (!verifyShopifyHmac(req)) {
        return res.status(401).send('Invalid HMAC');
    }

    console.log('[GDPR] customers_redact', req.body);

    res.status(200).send('ok');
});

// SHOP REDACT
router.post('/shop/redact', (req, res) => {
    if (!verifyShopifyHmac(req)) {
        return res.status(401).send('Invalid HMAC');
    }

    console.log('[GDPR] shop_redact', req.body);

    res.status(200).send('ok');
});

module.exports = router;