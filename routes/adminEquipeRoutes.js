const express = require('express');
const router = express.Router();
const ctrl = require('../controller/AdminEquipeController');
const { requireAdminRole } = require('../middleware/adminAuth');

router.get('/', ctrl.listAdminUsers);
router.post('/', requireAdminRole('admin'), ctrl.createAdminUser);
router.put('/:id', requireAdminRole('admin'), ctrl.updateAdminUser);
router.delete('/:id', requireAdminRole('admin'), ctrl.deleteAdminUser);

module.exports = router;
