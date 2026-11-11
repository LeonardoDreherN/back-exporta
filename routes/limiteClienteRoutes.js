const express = require('express');
const router = express.Router();
const ctrl = require('../controller/LimiteClienteController');

// Só leitura: o cliente vê o próprio limite, não mexe nele.
router.get('/meu', ctrl.meuLimite);

module.exports = router;
