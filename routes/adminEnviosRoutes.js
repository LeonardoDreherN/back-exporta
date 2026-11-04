const express = require('express');
const router = express.Router();
const ctrl = require('../controller/AdminEnviosController');

router.get('/', ctrl.listEnvios);
router.get('/rastreio/:tracking', ctrl.buscarPorRastreio);
router.post('/reconciliar', ctrl.reconciliarLote);
router.get('/:id', ctrl.getEnvioDetail);

// Correcao da invoice depois de emitida: reescreve o PDF a partir de
// pedido + ajustes, sem tocar no pedido. O download e separado do que o
// cliente usa, que filtra por cliente_id e passa pela trava de pagamento.
router.get('/:id/invoice', ctrl.baixarInvoiceAdmin);
router.post('/:id/invoice/reemitir', ctrl.reemitirInvoice);

module.exports = router;
