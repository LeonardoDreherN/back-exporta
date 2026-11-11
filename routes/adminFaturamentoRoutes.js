const express = require('express');
const router = express.Router();
const ctrl = require('../controller/AdminFaturamentoController');
const { requireAdminRole } = require('../middleware/adminAuth');

// Leitura e simulação: qualquer admin autenticado confere.
router.get('/:clienteId', ctrl.listar);
router.get('/:clienteId/ajuste', ctrl.ajusteMercado);
router.post('/:clienteId/simular', ctrl.simular);

// Escrita mexe na base do imposto de todo pedido do cliente, então fica
// atrás de papel — mesma régua da aprovação de regime.
router.put('/:clienteId/config', requireAdminRole('admin', 'operations'), ctrl.salvarConfig);
router.post('/:clienteId/importar', requireAdminRole('admin', 'operations'), ctrl.importar);
router.delete('/:clienteId/sku/:id', requireAdminRole('admin', 'operations'), ctrl.remover);

module.exports = router;
