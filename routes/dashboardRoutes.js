// routes/upsRoutes.js
const express = require('express');
const cors = require('cors');
const ctrl = require('../controller/Dashboard');
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

router.get('/valorTotal', corsOpts, ctrl.valorTotalCotacoes)
router.get('/valorMedio/cotacoes', corsOpts, ctrl.valorMedioPorCotacao)
router.get('/porcentagem/transportadora', corsOpts, ctrl.porcentagemTransportadora)
router.get('/porcentagem/pais-destinatario', corsOpts, ctrl.porcentagemPaisDestinatario)
router.get('/porcentagem/mesAnterior', corsOpts, ctrl.mesAnterior)
router.get('/valorMedio/pais', corsOpts, ctrl.valorMedioPorPais)
router.get('/cotacoesPorData/hoje', corsOpts, ctrl.cotacaoHoje)
router.get('/cotacoesPorData/mes', corsOpts, ctrl.cotacaoMes)
router.get('/cotacoesPorData/ontem', corsOpts, ctrl.cotacaoOntem)
router.get('/cotacoesPorData/semana', corsOpts, ctrl.cotacaoSemana)


module.exports = router;
