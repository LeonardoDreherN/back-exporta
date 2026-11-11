// routes/shipmentsRoutes.js
const express = require('express');
const router = express.Router();

const ctrl = require('../controller/ShipmentsController');
const { autenticarUsuario, vincularCliente } = require('../middleware/auth');
const { bloquearEnvios } = require('../middleware/enviosBloqueados');
const { limitarPorCredito } = require('../middleware/limiteCredito');

router.post('/compare', autenticarUsuario, vincularCliente, bloquearEnvios, ctrl.compareRates);
router.post('/:id/confirm', autenticarUsuario, vincularCliente, bloquearEnvios, limitarPorCredito, ctrl.confirmRate);

module.exports = router;
