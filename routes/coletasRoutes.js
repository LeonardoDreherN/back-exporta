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
            // Já estavam gravados e a listagem não devolvia. São o que o
            // motorista procura ao chegar no endereço.
            contactName: r.contact_name,
            phone: r.phone,
        }));

        return res.json(data);
    } catch (err) {
        console.error('[COLETAS][LIST][ERR]', err?.message);
        return res.status(500).json({ ok: false, error: 'Falha ao listar coletas agendadas.' });
    }
});

/**
 * Marca a coleta como cancelada.
 *
 * ATENÇÃO: cancela só no nosso banco. Não existe chamada de Cancel Pickup
 * (FedEx) nem Void Pickup (UPS) em lugar nenhum do sistema — o agendamento
 * segue de pé na transportadora e o motorista vai aparecer no endereço. A
 * decisão de ter o botão assim mesmo foi tomada com esse alerta na mesa
 * (2026-10-22); a tela avisa o usuário em cada cancelamento.
 *
 * Quando o cancelamento de verdade existir, é aqui que ele entra, antes do
 * update — e o aviso sai da tela.
 */
router.post('/:id/cancelar', requireAuth, async (req, res) => {
    try {
        const cid = req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId;
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ ok: false, error: 'ID inválido.' });
        }

        // Filtra por cliente: sem isso, trocar o id na URL cancelaria a coleta
        // de outra conta.
        const coleta = await db.ColetaAgendada.findOne({
            where: { id, cliente_id: cid },
        });

        if (!coleta) {
            return res.status(404).json({ ok: false, error: 'Coleta não encontrada.' });
        }

        if (String(coleta.status).toUpperCase() === 'CANCELADA') {
            return res.json({ ok: true, ja_cancelada: true, id: coleta.id });
        }

        await coleta.update({ status: 'CANCELADA' });

        return res.json({ ok: true, id: coleta.id, status: coleta.status });
    } catch (err) {
        console.error('[COLETAS][CANCELAR][ERR]', err?.message);
        return res.status(500).json({ ok: false, error: 'Falha ao cancelar a coleta.' });
    }
});

module.exports = router;
