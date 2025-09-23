// GET /api/cotacoes?limit=20&offset=0&pais_dest=US&moeda=USD&pedido_ref=D5
const { Cotacao } = require('../models');

const ALLOW = process.env.FRONTEND_URL || '*';

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', ALLOW);
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-cliente-id');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

    try {
        const cliente_id = (req.headers['x-cliente-id'] || req.query.cliente_id || '').toString().trim();
        if (!cliente_id) return res.status(400).json({ ok: false, error: 'cliente_id obrigatório' });

        const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
        const offset = Math.max(0, Number(req.query.offset || 0));
        const where = { cliente_id };

        if (req.query.pais_dest) where.pais_dest = req.query.pais_dest;
        if (req.query.moeda) where.moeda_emissao = req.query.moeda;
        if (req.query.pedido_ref) where.pedido_ref = req.query.pedido_ref;

        const rows = await Cotacao.findAll({
            where,
            order: [['created_at', 'DESC']],
            limit, offset
        });

        return res.status(200).json({ ok: true, cliente_id, limit, offset, itens: rows });
    } catch (e) {
        return res.status(400).json({ ok: false, error: e?.message || 'bad request' });
    }
};
