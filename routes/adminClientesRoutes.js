const express = require('express');
const router = express.Router();
const ctrl = require('../controller/AdminClientesController');
const { requireAdminRole } = require('../middleware/adminAuth');

router.get('/', ctrl.listClientes);
router.get('/:id', ctrl.getClienteDetail);
router.patch('/:id/status', requireAdminRole('admin', 'operations'), ctrl.updateClienteStatus);
router.post('/:id/api-key/regenerate', requireAdminRole('admin', 'operations'), ctrl.regeneratePublicApiKey);

module.exports = router;
