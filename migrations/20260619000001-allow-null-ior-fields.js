"use strict";

const IOR_FIELDS = [
  "descIOR", "nomeIOR", "emailIOR", "tipoIOR", "paisIOR",
  "cod_postalIOR", "estadoIOR", "cidadeIOR", "enderecoIOR",
  "numeroIOR", "telefoneIOR", "state_tax_idIOR"
];

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const field of IOR_FIELDS) {
      await queryInterface.changeColumn("Clientes", field, {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    for (const field of IOR_FIELDS) {
      await queryInterface.changeColumn("Clientes", field, {
        type: Sequelize.STRING,
        allowNull: false,
      });
    }
  },
};
