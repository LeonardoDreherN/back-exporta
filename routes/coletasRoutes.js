// routes/coletasRoutes.js
const express = require('express');
const router = express.Router();

const db = require('../models');

function requireAuth(req, res, next) {
    const cid = req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId;
    if (!cid) return res.status(401).json({ erro: 'unauthorized' });
    next();
}

function formatEndereco(row) {
    const linha = [row.rua, row.numero].filter(Boolean).join(', ');
    return [linha, row.cidade, row.estado, row.cep, row.pais].filter(Boolean).join(' - ');
}

router.get('/', requireAuth, async (req, res) => {
    try {
        const cid = req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId;

        const rows = await db.ColetaAgendada.findAll({
            where: { cliente_id: cid },
            order: [['pickup_date', 'DESC'], ['created_at', 'DESC']],
        });

        const data = rows.map((r) => ({
            id: r.id,
            carrier: r.carrier,
            pickupDate: r.pickup_date,
            readyTime: r.ready_time,
            closeTime: r.close_time,
            endereco: formatEndereco(r),
            confirmationNumber: r.confirmation_number,
            status: r.status,
            createdAt: r.created_at,
        }));

        return res.json(data);
    } catch (err) {
        console.error('[COLETAS][LIST][ERR]', err?.message);
        return res.status(500).json({ ok: false, error: 'Falha ao listar coletas agendadas.' });
    }
});

module.exports = router;
