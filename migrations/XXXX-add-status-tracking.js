// migrations/XXXX-add-status-tracking.js
module.exports = {
    up: async (q, Sequelize) => {
        await q.addColumn('Cotacoes', 'status_norm', {
            type: Sequelize.ENUM('CRIADO', 'EM_TRANSITO', 'ENTREGUE'),
            allowNull: false,
            defaultValue: 'CRIADO',
        });
        await q.addColumn('Cotacoes', 'last_tracking_at', { type: Sequelize.DATE, allowNull: true });
        await q.addColumn('Cotacoes', 'tracking_raw', { type: Sequelize.JSONB, allowNull: true });
        await q.addIndex('Cotacoes', ['status_norm']);
    },
    down: async (q) => {
        await q.removeIndex('Cotacoes', ['status_norm']);
        await q.removeColumn('Cotacoes', 'tracking_raw');
        await q.removeColumn('Cotacoes', 'last_tracking_at');
        await q.removeColumn('Cotacoes', 'status_norm');
    },
};
