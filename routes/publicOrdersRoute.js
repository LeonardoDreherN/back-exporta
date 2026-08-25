const express = require('express');
const { publicCreateOrder } = require('../controller/PedidoImportController');
const { publicApiKeyAuth } = require('../middleware/publicApiKeyAuth');

const router = express.Router();

router.post('/', publicApiKeyAuth, publicCreateOrder);

module.exports = router;
