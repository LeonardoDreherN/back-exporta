const express = require('express');
const router = express.Router();
const { getBannerForCliente } = require('../controller/AdminComunicacaoController');

router.get('/banner', getBannerForCliente);

module.exports = router;
