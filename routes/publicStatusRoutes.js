const express = require('express');
const router = express.Router();
const { getPublicStatus } = require('../controller/PublicStatusController');

router.get('/', getPublicStatus);

module.exports = router;
