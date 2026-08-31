'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('cotacoes', 'impostos_valor_brl', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn('cotacoes', 'impostos_moeda', {
      type: Sequelize.STRING(3),
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn('cotacoes', 'impostos_estimados', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn('cotacoes', 'imposto_estimativa_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn('cotacoes', 'impostos_modo', {
      type: Sequelize.STRING(16),
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('cotacoes', 'impostos_valor_brl');
    await queryInterface.removeColumn('cotacoes', 'impostos_moeda');
    await queryInterface.removeColumn('cotacoes', 'impostos_estimados');
    await queryInterface.removeColumn('cotacoes', 'imposto_estimativa_id');
    await queryInterface.removeColumn('cotacoes', 'impostos_modo');
  },
};
