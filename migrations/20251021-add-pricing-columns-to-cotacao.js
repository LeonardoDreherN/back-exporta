'use strict';
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('Cotacaos', 'plano_aplicado', {
            type: Sequelize.STRING,
            allowNull: true,
        });
        await queryInterface.addColumn('Cotacaos', 'preco_base', {
            type: Sequelize.DECIMAL(12, 2),
            allowNull: true,
        });
        await queryInterface.addColumn('Cotacaos', 'preco_final', {
            type: Sequelize.DECIMAL(12, 2),
            allowNull: true,
        });
    },
    async down(queryInterface) {
        await queryInterface.removeColumn('Cotacaos', 'plano_aplicado');
        await queryInterface.removeColumn('Cotacaos', 'preco_base');
        await queryInterface.removeColumn('Cotacaos', 'preco_final');
    }
};
