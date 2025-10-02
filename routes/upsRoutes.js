const router = require('express').Router();
const ctrl = require('../controller/upsController');

router.post('/rating', ctrl.rate);
router.post('/shipping', ctrl.ship);
router.get('/tracking/:tracking', ctrl.track);

module.exports = router;
