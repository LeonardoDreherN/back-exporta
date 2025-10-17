// routes/upsRoutes.js
const express = require('express');
const cors = require('cors');
const ctrl = require('../controller/upsController');

const router = express.Router();

// CORS só para essas rotas (aceita localhost, 127.0.0.1 e ::1 em qualquer porta)
const corsOpts = cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true); // Postman/cURL
        const ok =
            /^https?:\/\/localhost(:\d+)?$/i.test(origin) ||
            /^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin) ||
            /^https?:\/\/\[::1\](:\d+)?$/i.test(origin) ||
            /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/i.test(origin);
        return cb(null, ok)
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization', 'authorization',
        'transId', 'transactionSrc', 'x-cliente-id', 'x-idempotency-key'
    ],
    exposedHeaders: ['Authorization'],
    optionsSuccessStatus: 204,
});

// Preflight (IMPORTANTÍSSIMO para o browser liberar o POST)
router.options('/rating', corsOpts, (_req, res) => res.sendStatus(204));
router.options('/shipping', corsOpts, (_req, res) => res.sendStatus(204));
router.options('/tracking/:tracking', corsOpts, (_req, res) => res.sendStatus(204));

// Rotas
router.post('/rating', corsOpts, ctrl.rate);
router.post('/shipping', corsOpts, ctrl.ship);
router.get('/tracking/:tracking', corsOpts, ctrl.track);

async function upsertStatus(trackingNumber, carrier, evt){
    const row = await Cotacao.findOnde({ where: {tracking_number: trackingNumber}})

    if(!row) return;

    const novo = normalize(carrier, evt);
    const t = new Date(evt.eventTime || Date.now());
    const newer = !row.last_tracking_at || t > row.last_tracking_at;

    if(newer || row.status_norm !== novo){
        await row.update({
            status_norm: novo,
            last_tracking_at: t,
            tracking_raw: evt,
        });
    }
}

router.post('/webhook/ups-tracking', express.json(), async (req, res) => {
    const body = req.body
    const trackingNumber = body?.trackingNumber || body?.trackNumber;
    const evt = {
        statusCode: body?.statusCode,
        statusDescription: body?.statusDescription,
        eventTime: body?.eventTime,
    }
    await upsertStatus(trackingNumber, 'UPS', evt);
    res.sendStatus(200);
})

module.exports = router;
