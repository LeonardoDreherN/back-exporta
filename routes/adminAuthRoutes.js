const express = require('express');
const router = express.Router();

const { loginAdmin, meAdmin, refreshAdmin, logoutAdmin } = require('../controller/AdminAuthController');
const { autenticarAdmin } = require('../middleware/adminAuth');

router.post('/login', loginAdmin);
router.post('/auth/refresh', refreshAdmin);
router.post('/auth/logout', logoutAdmin);
router.get('/me', autenticarAdmin, meAdmin);

module.exports = router;
