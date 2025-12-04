// routes/cotacoesRoutes.js
const express = require('express');
const router = express.Router();

const db = require('../models');
const { sequelize } = db;
const { Cliente, PlanoLogs } = db;

const ctrl = require('../controller/CotacaoController'); // ← caminho atual
const { agendarPickupCotacao } = require('../services/ups/cotacaoUps');

function requireAuth(req, res, next) {
    const cid = req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId;
    if (!cid) return res.status(401).json({ erro: 'unauthorized' });
    next();
}

async function attachClientePlano(req, _res, next) {
    try {
        const cid = req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId;
        if (!cid) return next();
        const cli = await Cliente.findByPk(cid, { attributes: ['id', 'plano'] });
        req.cliente = { id: cli?.id ?? cid, plano: cli?.plano ?? 'basico' };
        next();
    } catch (e) { next(e); }
}

router.use(attachClientePlano);

// CRUD principal
router.get('/', requireAuth, ctrl.listCotacoes);
router.post('/', requireAuth, ctrl.createCotacaoReal);
router.get('/:id/details', requireAuth, ctrl.getCotacaoDetails);
router.get('/status-por-pedido/:pedido_ref', requireAuth, ctrl.getCotacaoStatusByPedidoRef);
router.get('/:id', requireAuth, ctrl.getCotacao);
router.post('/:id/docs', requireAuth, ctrl.attachDocs);
router.get('/:id/etiqueta', requireAuth, ctrl.downloadEtiqueta);
router.get('/:id/invoice', requireAuth, ctrl.downloadInvoice);

router.post('/:id/pickup', requireAuth, agendarPickupCotacao)


// Ajuste de plano do cliente (opcional manter aqui)
router.patch('/clientes/:id/plano', async (req, res) => {
    const { id } = req.params;
    const { plano, motivo } = req.body;

    if (!['basico', 'premium', 'gold', 'parceiro'].includes(plano)) {
        return res.status(400).json({ error: 'plano inválido' });
    }

    const t = await sequelize.transaction();
    try {
        const cliente = await Cliente.findByPk(id, { transaction: t });
        if (!cliente) { await t.rollback(); return res.status(404).send(); }

        const old = cliente.plano;
        await cliente.update({ plano }, { transaction: t });

        if (PlanoLogs) {
            await PlanoLogs.create({
                cliente_id: cliente.id,
                old_plano: old,
                new_plano: plano,
                motivo: motivo || null,
                changed_by: req.user?.id || null
            }, { transaction: t });
        }

        if (global.redis) await global.redis.del(`quote:cliente:${cliente.id}`);

        await t.commit();
        return res.status(204).send();
    } catch (err) {
        await t.rollback();
        console.error('[PATCH /clientes/:id/plano]', err);
        return res.status(500).json({ error: 'erro interno' });
    }
});

module.exports = router;
