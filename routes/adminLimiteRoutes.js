const express = require('express');
const router = express.Router();
const ctrl = require('../controller/AdminLimiteController');
const { requireAdminRole } = require('../middleware/adminAuth');

// Leitura: qualquer admin autenticado acompanha a exposição das contas.
router.get('/', ctrl.panorama);
router.get('/niveis', ctrl.niveis);
router.get('/:clienteId', ctrl.detalhe);
router.get('/:clienteId/abertos', ctrl.enviosAbertos);
router.get('/:clienteId/simular', ctrl.simular);

// Escrita decide quem consegue despachar e o que conta como pago: fica atrás
// de papel, mesma régua da aprovação de regime.
router.post('/:clienteId/ativar', requireAdminRole('admin', 'operations'), ctrl.ativar);
router.put('/:clienteId/nivel', requireAdminRole('admin', 'operations'), ctrl.definirNivel);
router.post('/:clienteId/promover', requireAdminRole('admin', 'operations'), ctrl.promover);
router.post('/baixa', requireAdminRole('admin', 'operations'), ctrl.darBaixa);
router.delete('/baixa/:cotacaoId', requireAdminRole('admin', 'operations'), ctrl.desfazerBaixa);

module.exports = router;
