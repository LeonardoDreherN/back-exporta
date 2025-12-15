// routes/fedexRoutes.js
const express = require('express');
const cors = require('cors');
const { autenticarUsuario } = require('../middleware/auth');
const ctrl = require('../controller/fedexController');
const cfgFedex = require('../config/fedex')

const router = express.Router();

// CORS local (igual UPS)
const corsOpts = cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true); // Postman/cURL
        const ok =
            /^https?:\/\/localhost(:\d+)?$/i.test(origin) ||
            /^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin) ||
            /^https?:\/\/\[::1\](:\d+)?$/i.test(origin) ||
            /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/i.test(origin);
        return cb(null, ok);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'authorization', 'x-cliente-id', 'x-idempotency-key'],
    exposedHeaders: ['Authorization'],
    optionsSuccessStatus: 204,
});

// Preflight
router.options('/rating', corsOpts, (_req, res) => res.sendStatus(204));
router.options('/shipping', corsOpts, (_req, res) => res.sendStatus(204));
router.options('/tracking/:tracking', corsOpts, (_req, res) => res.sendStatus(204));

// Rotas
router.post('/rating', corsOpts, autenticarUsuario, ctrl.rate);
router.post('/shipping', corsOpts, autenticarUsuario, ctrl.ship);
router.post('/tracking/:tracking', corsOpts, autenticarUsuario, ctrl.track);

router.get('/_debug/fedex', (req, res) => {
    res.json({
        AMBIENTE: process.env.NODE_ENV,
        base: fedexCfg.base,
        oauth: fedexCfg.oauth,
        ship: fedexCfg.ship,
        clientId_set: !!fedexCfg.clientId,
        accountNumber: fedexCfg.accountNumber || '(none)'
    });
});

module.exports = router;
