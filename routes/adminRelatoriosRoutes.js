const express = require('express');
const router = express.Router();
const ctrl = require('../controller/AdminRelatoriosController');

router.get('/envios-por-cliente', ctrl.enviosPorCliente);
router.get('/envios-por-periodo', ctrl.enviosPorPeriodo);
router.get('/shopify-x-nuvemshop', ctrl.shopifyXNuvemshop);
router.get('/ups-x-fedex', ctrl.upsXFedex);
router.get('/crescimento-mensal', ctrl.crescimentoMensal);
router.get('/paises-destino', ctrl.paisesDestino);

module.exports = router;
