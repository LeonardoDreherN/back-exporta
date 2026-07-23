'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Clientes', 'tipoDocumento', {
      type: Sequelize.ENUM('cnpj', 'cpf', 'estrangeiro'),
      allowNull: false,
      defaultValue: 'cnpj',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Clientes', 'tipoDocumento');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_Clientes_tipoDocumento";');
  },
};
