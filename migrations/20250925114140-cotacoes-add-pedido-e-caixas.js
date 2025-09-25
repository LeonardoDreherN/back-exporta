// migrations/20250925-cotacoes-add-pedido-e-caixas.js
'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        const qi = queryInterface;
        const { JSONB } = Sequelize;

        await qi.addColumn('cotacoes', 'pedido', { type: JSONB, allowNull: false, defaultValue: {} });
        await qi.addColumn('cotacoes', 'caixas', { type: JSONB, allowNull: false, defaultValue: [] });

        await qi.sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_cotacoes_pedido_gin
            ON cotacoes USING GIN (pedido jsonb_path_ops);
    `);
    },

    async down(queryInterface, Sequelize) {
        const qi = queryInterface;
        await qi.sequelize.query(`DROP INDEX IF EXISTS idx_cotacoes_pedido_gin;`);
        await qi.removeColumn('cotacoes', 'pedido');
        await qi.removeColumn('cotacoes', 'caixas');
    },
};
