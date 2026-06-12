const express = require('express');
const { publicQuote } = require('../controller/publicQuoteController');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');

const router = express.Router();

router.post('/', apiKeyAuth, publicQuote);

module.exports = router;
