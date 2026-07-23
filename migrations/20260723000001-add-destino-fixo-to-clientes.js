'use strict';

const FIELDS = [
  'destinoFixoNome',
  'destinoFixoPais',
  'destinoFixoEstado',
  'destinoFixoCidade',
  'destinoFixoRua',
  'destinoFixoCEP',
  'destinoFixoTelefone',
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    for (const field of FIELDS) {
      await queryInterface.addColumn('Clientes', field, {
        type: Sequelize.STRING,
        allowNull: true,
        defaultValue: null,
      });
    }
  },

  async down(queryInterface) {
    for (const field of FIELDS) {
      await queryInterface.removeColumn('Clientes', field);
    }
  },
};
