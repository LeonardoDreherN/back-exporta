const express = require('express');
const router = express.Router();
const ctrl = require('../controller/AdminLeadsController');

// Só leitura: o lead é capturado pelo /api/public-quote e nada aqui o altera.
router.get('/', ctrl.listar);

module.exports = router;
