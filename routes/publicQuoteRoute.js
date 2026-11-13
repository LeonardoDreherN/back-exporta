const express = require('express');
const { publicQuote, publicImpostos, publicLead } = require('../controller/publicQuoteController');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');

const router = express.Router();

router.post('/', apiKeyAuth, publicQuote);
router.post('/impostos', apiKeyAuth, publicImpostos);
// Grava o cadastro do modal sem refazer a cotacao, e responde se gravou.
router.post('/lead', apiKeyAuth, publicLead);

module.exports = router;
