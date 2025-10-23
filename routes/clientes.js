// PATCH /clientes/:id/plano
router.patch('/:id/plano', async (req, res) => {
    const { id } = req.params;
    const { plano, motivo } = req.body;
    if (!['basico', 'gold', 'premium', 'parceiro'].includes(plano)) {
        return res.status(400).json({ error: 'plano inválido' });
    }

    const t = await sequelize.transaction();
    try {
        const cliente = await sequelize.models.Cliente.findByPk(id, { transaction: t });
        if (!cliente) { await t.rollback(); return res.status(404).send(); }

        const old = cliente.plano;
        await cliente.update({ plano }, { transaction: t });

        await sequelize.models.PlanoLogs.create({
            cliente_id: cliente.id,
            old_plano: old,
            new_plano: plano,
            motivo: motivo || null,
            changed_by: req.user?.id || null
        }, { transaction: t });

        // invalida cache (exemplo com Redis)
        if (global.redis) await global.redis.del(`quote:cliente:${cliente.id}`);

        await t.commit();
        return res.status(204).send();
    } catch (err) {
        await t.rollback();
        console.error(err);
        return res.status(500).json({ error: 'erro interno' });
    }
});
