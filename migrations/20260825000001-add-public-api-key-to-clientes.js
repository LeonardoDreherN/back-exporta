'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Clientes', 'publicApiKey', {
      type: Sequelize.STRING,
      allowNull: true,
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Clientes', 'publicApiKey');
  },
};
