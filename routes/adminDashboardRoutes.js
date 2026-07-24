const express = require('express');
const router = express.Router();
const ctrl = require('../controller/AdminDashboardController');

router.get('/summary', ctrl.summary);
router.get('/period-summary', ctrl.periodSummary);
router.get('/charts/envios-por-dia', ctrl.enviosPorDia);
router.get('/charts/crescimento-mensal', ctrl.crescimentoMensal);
router.get('/charts/distribuicao-transportadora', ctrl.distribuicaoTransportadora);
router.get('/charts/novos-clientes', ctrl.novosClientes);
router.get('/charts/pedidos-importados', ctrl.pedidosImportados);
router.get('/charts/valor-por-cliente', ctrl.valorPorCliente);
router.get('/charts/envios-por-pais', ctrl.enviosPorPais);
router.get('/charts/funil-conversao', ctrl.funilConversao);
router.get('/charts/sla-transportadora', ctrl.slaTransportadora);

module.exports = router;
