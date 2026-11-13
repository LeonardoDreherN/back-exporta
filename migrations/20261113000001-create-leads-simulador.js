'use strict';

/**
 * Contatos deixados no simulador da página Sobre.
 *
 * O formulário público exige e-mail e WhatsApp para mostrar o preço, mas o
 * /api/public-quote lia só peso e destino: o contato chegava no corpo da
 * requisição e era jogado fora. Esta tabela é onde ele passa a ficar, para
 * aparecer em /admin/leads.
 *
 * Tabela nova, então o sync() do boot também a cria sozinha — a migration
 * existe para o registro e para ambiente com INTREX_LOCAL=1, onde o sync
 * não roda.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('leads_simulador', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      email: { type: Sequelize.STRING(160), allowNull: true },
      telefone: { type: Sequelize.STRING(20), allowNull: true },
      origem: { type: Sequelize.STRING(60), allowNull: true },

      destino: { type: Sequelize.STRING(2), allowNull: true },
      peso_kg: { type: Sequelize.DECIMAL(8, 3), allowNull: true },
      comprimento_cm: { type: Sequelize.INTEGER, allowNull: true },
      largura_cm: { type: Sequelize.INTEGER, allowNull: true },
      altura_cm: { type: Sequelize.INTEGER, allowNull: true },

      cotou: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      melhor_carrier: { type: Sequelize.STRING(20), allowNull: true },
      melhor_preco_usd: { type: Sequelize.DECIMAL(10, 2), allowNull: true },

      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    // A tela lista por data e busca por e-mail; são as duas únicas consultas.
    await queryInterface.addIndex('leads_simulador', ['created_at']);
    await queryInterface.addIndex('leads_simulador', ['email']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('leads_simulador');
  },
};
