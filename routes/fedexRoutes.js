// routes/fedexRoutes.js
const express = require('express');
const cors = require('cors');
const { autenticarUsuario } = require('../middleware/auth');
const ctrl = require('../controller/fedexCotacaoController');
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
router.options('/rate', corsOpts, (_req, res) => res.sendStatus(204));
router.options('/ship', corsOpts, (_req, res) => res.sendStatus(204));

// Rotas
router.post('/rate', corsOpts, autenticarUsuario, ctrl.createCotacaoRealFedex);
router.post('/ship', corsOpts, autenticarUsuario, ctrl.shipFedex);

router.get('/_debug/fedex', (req, res) => {
    res.json({
        AMBIENTE: process.env.FEDEX_AMBIENTE,
        base: fedexCfg.base,
        oauth: fedexCfg.oauth,
        ship: fedexCfg.ship,
        clientId_set: !!fedexCfg.clientId,
        accountNumber: fedexCfg.accountNumber || '(none)'
    });
});

module.exports = router;
