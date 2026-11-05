const express = require('express');
const router = express.Router();
const ctrl = require('../controller/AdminRegimeController');
const { requireAdminRole } = require('../middleware/adminAuth');

router.get('/', ctrl.listar);
router.get('/:id', ctrl.detalhe);

// Apurar e aprovar mexem no que o cliente paga, então ficam atrás de papel.
router.post('/pesquisar', requireAdminRole('admin', 'developer', 'operations'), ctrl.pesquisar);
router.post('/:id/aprovar', requireAdminRole('admin', 'operations'), ctrl.aprovar);
router.post('/:id/rejeitar', requireAdminRole('admin', 'developer', 'operations'), ctrl.rejeitar);

module.exports = router;
