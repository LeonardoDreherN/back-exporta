const express = require('express');
const cors = require('cors');
const ctrl = require('../controller/worldeaseController');

const router = express.Router();

const corsOpts = cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const ok =
            /^https?:\/\/localhost(:\d+)?$/i.test(origin) ||
            /^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin) ||
            /^https?:\/\/\[::1\](:\d+)?$/i.test(origin) ||
            /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/i.test(origin);
        return cb(null, ok);
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'authorization', 'x-cliente-id'],
    optionsSuccessStatus: 204,
});

router.options('(.*)', corsOpts, (_req, res) => res.sendStatus(204));

router.get('/masters', corsOpts, ctrl.listMasters);
router.post('/masters', corsOpts, ctrl.createMaster);
router.post('/masters/:id/closeout', corsOpts, ctrl.closeout);
router.delete('/masters/:id', corsOpts, ctrl.deleteMaster);

module.exports = router;
