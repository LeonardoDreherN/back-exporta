// routes/upsRoutes.js
const express = require('express');
const cors = require('cors');
const ctrl = require('../controller/upsController');
const { Cotacao } = require('../models');

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
router.options('/shipments', corsOpts, (_req, res) => res.sendStatus(204));
router.options('/pickup', corsOpts, (_req, res) => res.sendStatus(204));

// Rotas
router.post('/rating', corsOpts, ctrl.rate);
router.post('/shipping', corsOpts, ctrl.ship);
router.get('/tracking/:tracking', corsOpts, ctrl.track);
router.post('/pickup', corsOpts, ctrl.createPickup);

router.post('/shipping', corsOpts, async (req, res, next) => {
    const b = req.body || {};
    const isLight = b && (b.rate_result || b.ship_result || b.status);
    if (!isLight) return ctrl.ship(req, res, next);

    const tracking_number =
        b.ship_result?.trackingNumbers?.[0] ||
        b.tracking_number || null;

    return res.status(201).json({
        ok: true,
        id: Date.now(),
        carrier: b.carrier || 'UPS',
        status: b.status || 'created',
        tracking_number,
        rate_result: b.rate_result || null,
        ship_result: b.ship_result || null,
        track_result: b.track_result || null,
        message: 'Remessa registrada (light)',
    });
});

// Mock “puro” para registrar remessas leves
router.post('/shipments', corsOpts, async (req, res) => {
    try {
        const b = req.body || {};
        const tracking_number =
            b.ship_result?.trackingNumbers?.[0] ||
            b.tracking_number || null;

        return res.status(201).json({
            ok: true,
            id: Date.now(),
            carrier: b.carrier || 'UPS',
            status: b.status || 'created',
            tracking_number,
            rate_result: b.rate_result || null,
            ship_result: b.ship_result || null,
            track_result: b.track_result || null,
            message: 'Remessa criada (mock)',
        });
    } catch (err) {
        console.error('[UPS] erro /shipments:', err);
        res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
});

async function upsertStatus(trackingNumber, carrier, evt) {
    const row = await Cotacao.findOne({ where: { tracking_number: trackingNumber } })
    if (!row) return;

    const hasAnySignal = evt.statusCode || evt.statusDescription || evt.eventTime;
    if (!hasAnySignal) return;

    let novo = normalize(carrier, evt);
    if (!novo || novo === 'CRIADO') novo = 'CRIADO';

    const t = new Date(evt.eventTime || Date.now());
    const newer = !row.last_tracking_at || t > row.last_tracking_at;

    if (newer || row.status_norm !== novo) {
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
