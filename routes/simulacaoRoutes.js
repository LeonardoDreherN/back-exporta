// routes/simulacaoRoutes.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controller/SimulacaoController');

const router = express.Router();

function requireAuth(req, res, next) {
    const cid = req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId;
    if (!cid) return res.status(401).json({ ok: false, error: 'unauthorized' });
    next();
}

// Cada simulacao dispara 3 chamadas UPS + 2 FedEx. Sem teto, um cliente
// segurando o botao queima a cota das transportadoras para todo mundo.
// Chave e o cliente (requireAuth roda antes, entao clienteId sempre existe);
// sem fallback de IP para nao cair no ERR_ERL_KEY_GEN_IPV6.
const simulacaoLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId),
    message: { ok: false, error: 'Muitas simulacoes seguidas. Aguarde alguns minutos.' },
});

router.get('/opcoes', requireAuth, ctrl.opcoes);
router.post('/', requireAuth, simulacaoLimiter, ctrl.simulacao);

module.exports = router;
