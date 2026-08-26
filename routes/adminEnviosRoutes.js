const express = require('express');
const router = express.Router();
const ctrl = require('../controller/AdminEnviosController');

router.get('/', ctrl.listEnvios);
router.get('/rastreio/:tracking', ctrl.buscarPorRastreio);
router.get('/:id', ctrl.getEnvioDetail);

module.exports = router;
