'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('cotacoes', 'etiqueta_base64', { type: Sequelize.TEXT, allowNull: true });
        await queryInterface.addColumn('cotacoes', 'etiqueta_mime', { type: Sequelize.STRING(32), allowNull: true });

        await queryInterface.addColumn('cotacoes', 'invoice_base64', { type: Sequelize.TEXT, allowNull: true });
        await queryInterface.addColumn('cotacoes', 'invoice_mime', { type: Sequelize.STRING(32), allowNull: true });

        await queryInterface.addColumn('cotacoes', 'tracking_number', { type: Sequelize.STRING(64), allowNull: true });

        // índice auxiliar para tracking
        await queryInterface.addIndex('cotacoes', ['tracking_number'], {
            name: 'cotacoes_tracking_number_idx',
        });
    },

    async down(queryInterface) {
        await queryInterface.removeIndex('cotacoes', 'cotacoes_tracking_number_idx');

        await queryInterface.removeColumn('cotacoes', 'tracking_number');
        await queryInterface.removeColumn('cotacoes', 'invoice_mime');
        await queryInterface.removeColumn('cotacoes', 'invoice_base64');
        await queryInterface.removeColumn('cotacoes', 'etiqueta_mime');
        await queryInterface.removeColumn('cotacoes', 'etiqueta_base64');
    }
};
