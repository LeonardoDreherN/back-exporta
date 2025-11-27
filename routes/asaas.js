// routes/upsRoutes.js
const express = require('express');
const cors = require('cors');

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

URL_ASAAS = "https://api-sandbox.asaas.com/v3";



module.exports = router;
