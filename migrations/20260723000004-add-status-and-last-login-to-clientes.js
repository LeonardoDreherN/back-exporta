'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Clientes', 'status', {
      type: Sequelize.ENUM('ativo', 'inativo', 'suspenso'),
      allowNull: false,
      defaultValue: 'ativo',
    });
    await queryInterface.addColumn('Clientes', 'lastLoginAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Clientes', 'lastLoginAt');
    await queryInterface.removeColumn('Clientes', 'status');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_Clientes_status";');
  },
};
