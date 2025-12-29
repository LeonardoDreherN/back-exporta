// routes/shipmentsRoutes.js
const express = require('express');
const router = express.Router();

const ctrl = require('../controller/ShipmentsController');
const { autenticarUsuario, vincularCliente } = require('../middleware/auth');

router.post('/compare', autenticarUsuario, vincularCliente, ctrl.compareRates);
router.post('/:id/confirm', autenticarUsuario, vincularCliente, ctrl.confirmRate);

module.exports = router;
