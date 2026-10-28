'use strict';

// Liberação da carteira sai da env var e vira coluna.
//
// Antes a allowlist era CARTEIRA_BETA_EMAILS no Render: para colocar um cliente
// no beta era preciso editar a variável e redeployar o serviço, e o admin não
// tinha como saber quem estava dentro. Com a coluna, liberar é um botão.
//
// A env var continua valendo (ver services/carteira/index.js): quem já está
// nela não pode perder a carteira por causa deste deploy. A coluna é um OU, não
// uma substituição — a troca completa acontece quando a lista estiver migrada.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Clientes', 'carteiraHabilitada', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    // Quem liberou e quando: a carteira move dinheiro, então a liberação
    // precisa de responsável, igual ao bloqueio de envios.
    await queryInterface.addColumn('Clientes', 'carteiraHabilitadaEm', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Clientes', 'carteiraHabilitadaEm');
    await queryInterface.removeColumn('Clientes', 'carteiraHabilitada');
  },
};
