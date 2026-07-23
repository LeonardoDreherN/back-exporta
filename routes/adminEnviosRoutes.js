const express = require('express');
const router = express.Router();
const ctrl = require('../controller/AdminEnviosController');

router.get('/', ctrl.listEnvios);
router.get('/:id', ctrl.getEnvioDetail);

module.exports = router;
