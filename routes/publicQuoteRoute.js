const express = require('express');
const { publicQuote, publicImpostos } = require('../controller/publicQuoteController');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');

const router = express.Router();

router.post('/', apiKeyAuth, publicQuote);
router.post('/impostos', apiKeyAuth, publicImpostos);

module.exports = router;
