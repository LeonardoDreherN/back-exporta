const express = require('express');
const router = express.Router();
const ctrl = require('../controller/AdminChangelogController');

router.get('/', ctrl.listEntries);
router.post('/', ctrl.createEntry);
router.put('/:id', ctrl.updateEntry);
router.delete('/:id', ctrl.deleteEntry);

module.exports = router;
