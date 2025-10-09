// routes/shipmentRoutes.js
const router = require('express').Router();
const ctrl = require('../controller/shipmentController');

router.post('/shipments', ctrl.create);     // salva os 3 steps (ou parte deles)
router.get('/shipments', ctrl.listMine);    // lista do usuário
router.get('/shipments/:id', ctrl.getOne);  // detalhes
router.patch('/shipments/:id', ctrl.update);// atualiza (ex.: track_result depois)

module.exports = router;
