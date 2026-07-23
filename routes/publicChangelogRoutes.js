const express = require('express');
const router = express.Router();
const { listPublicEntries } = require('../controller/AdminChangelogController');

router.get('/', listPublicEntries);

module.exports = router;
