const express = require('express');
const router = express.Router();
const ctrl = require('../controller/AdminRoadmapController');

router.get('/', ctrl.listCards);
router.post('/', ctrl.createCard);
router.put('/:id', ctrl.updateCard);
router.patch('/:id/move', ctrl.moveCard);
router.delete('/:id', ctrl.deleteCard);

module.exports = router;
