const express = require('express');
const router = express.Router();
const ctrl = require('../controller/AdminComunicacaoController');

router.get('/', ctrl.listAnnouncements);
router.post('/', ctrl.createAnnouncement);
router.put('/:id', ctrl.updateAnnouncement);
router.delete('/:id', ctrl.deleteAnnouncement);

module.exports = router;
