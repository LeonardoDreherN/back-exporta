const express = require('express');
const router = express.Router();
const ctrl = require('../controller/AdminIntegracoesController');
const { requireAdminRole } = require('../middleware/adminAuth');

router.get('/status', ctrl.getStatus);
router.put('/:key/status', requireAdminRole('admin', 'developer', 'operations'), ctrl.setStatus);
router.get('/logs', ctrl.getLogs);
router.post('/testar-alerta', requireAdminRole('admin', 'developer', 'operations'), ctrl.testarAlerta);

module.exports = router;
