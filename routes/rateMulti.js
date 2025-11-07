const router = require('express').Router();
const { rateMulti } = require('../services/rate/multi');

router.post('/multi', async (req, res) => {
    try {
        const payload = req.body || {};
        const { quotes, warnings } = await rateMulti(payload);
        res.json({ quotes, warnings: warnings || [] });
    } catch (e) {
        console.error('[RATE/MULTI][ERR]', e);
        res.status(400).json({ error: e.message || 'Falha ao cotar' });
    }
});

module.exports = router;
