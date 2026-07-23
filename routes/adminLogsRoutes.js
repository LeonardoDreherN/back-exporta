const express = require('express');
const router = express.Router();
const { listLogs } = require('../controller/AdminLogsController');

router.get('/', listLogs);

module.exports = router;
