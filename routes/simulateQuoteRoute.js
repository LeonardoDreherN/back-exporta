const express = require('express');
const rateLimit = require('express-rate-limit');
const { publicQuote } = require('../controller/publicQuoteController');

const router = express.Router();

// endpoint público sem API key, usado pelo simulador da landing page
const simulateLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true });

router.post('/', simulateLimiter, publicQuote);

module.exports = router;
