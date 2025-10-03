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
            /^http:\/\/localhost(:\d+)?$/i.test(origin) ||
            /^http:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin) ||
            /^http:\/\/\[::1\](:\d+)?$/i.test(origin);
        return cb(null, ok);
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

module.exports = router;
