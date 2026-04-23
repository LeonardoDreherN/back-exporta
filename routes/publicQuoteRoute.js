const express = require('express');
const { publicQuote } = require('../controller/publicQuoteController');

const router = express.Router();

router.post('/', publicQuote);

module.exports = router;
