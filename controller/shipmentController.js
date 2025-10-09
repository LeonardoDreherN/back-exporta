// controller/shipmentController.js
const { Shipment } = require('../models');

module.exports = {
    async create(req, res, next) {
        try {
            const userId = req.user?.id; // ajuste ao seu auth
            if (!userId) return res.status(401).json({ error: 'unauthorized' });

            const { rate_result, ship_result, track_result, carrier, status, shop_id } = req.body || {};
            const created = await Shipment.create({
                user_id: userId,
                shop_id: shop_id || null,
                rate_result: rate_result || null,
                ship_result: ship_result || null,
                track_result: track_result || null,
                carrier: carrier || 'UPS',
                status: status || 'created'
            });
            res.json(created);
        } catch (e) { next(e); }
    },

    async listMine(req, res, next) {
        try {
            const userId = req.user?.id;
            if (!userId) return res.status(401).json({ error: 'unauthorized' });

            const { page = 1, pageSize = 20 } = req.query;
            const rows = await Shipment.findAndCountAll({
                where: { user_id: userId },
                order: [['created_at', 'DESC']],
                offset: (Number(page) - 1) * Number(pageSize),
                limit: Number(pageSize)
            });
            res.json({ items: rows.rows, total: rows.count, page: Number(page), pageSize: Number(pageSize) });
        } catch (e) { next(e); }
    },

    async getOne(req, res, next) {
        try {
            const userId = req.user?.id;
            if (!userId) return res.status(401).json({ error: 'unauthorized' });

            const item = await Shipment.findOne({ where: { id: req.params.id, user_id: userId } });
            if (!item) return res.status(404).json({ error: 'not_found' });
            res.json(item);
        } catch (e) { next(e); }
    },

    async update(req, res, next) {
        try {
            const userId = req.user?.id;
            if (!userId) return res.status(401).json({ error: 'unauthorized' });

            // aceita patch parcial de qualquer um dos 3 jsons
            const patch = {};
            ['rate_result', 'ship_result', 'track_result', 'carrier', 'status'].forEach(k => {
                if (req.body?.[k] !== undefined) patch[k] = req.body[k];
            });

            const [n, rows] = await Shipment.update(patch, {
                where: { id: req.params.id, user_id: userId },
                returning: true
            });
            if (!n) return res.status(404).json({ error: 'not_found' });
            res.json(rows[0]);
        } catch (e) { next(e); }
    }
};
