const express = require('express');
const router = express.Router();
const ctrl = require('../controller/AdminChamadosController');
const { requireAdminRole } = require('../middleware/adminAuth');

// `support` aparece aqui pela primeira vez: o papel existia no enum de
// AdminUser e nenhuma rota o aceitava, então um usuário de suporte logava e não
// podia executar nada. Atender chamado é exatamente o trabalho dele.
const PODE_ATENDER = requireAdminRole('admin', 'support', 'operations');

router.get('/', ctrl.listar);
router.get('/:id', ctrl.detalhe);
router.get('/:id/mensagens/:mensagemId/anexo', ctrl.baixarAnexo);
router.post('/:id/mensagens', PODE_ATENDER, ctrl.responder);
router.patch('/:id', PODE_ATENDER, ctrl.atualizar);

module.exports = router;
