const express = require('express');
const router = express.Router();

router.post('/orders-create', async (req, res) => {
    try {
        console.log('[SHOPIFY WEBHOOK][ORDER CREATE] body:', JSON.stringify(req.body, null, 2));
        return res.status(200).send('ok');
    } catch (e) {
        console.error('[SHOPIFY WEBHOOK][ORDER CREATE][ERROR]', e);
        return res.status(500).send('error');
    }
});

module.exports = router;