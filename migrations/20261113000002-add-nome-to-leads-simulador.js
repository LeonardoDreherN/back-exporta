'use strict';

/**
 * Coluna `nome` em leads_simulador.
 *
 * O modal do simulador passou a pedir nome e WhatsApp, e o model, o INSERT do
 * /api/public-quote e o SELECT de /api/admin/leads já referenciam `nome`. A
 * tabela, porém, foi criada no deploy anterior SEM essa coluna — e o
 * `sequelize.sync()` do boot só cria tabela nova, nunca altera tabela que já
 * existe. Sem este ALTER, em produção:
 *
 *   - o INSERT do lead quebra com 42703 e cai no catch: nenhum contato grava;
 *   - o SELECT do admin quebra e /admin/leads devolve 500.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('leads_simulador', 'nome', {
      type: Sequelize.STRING(120),
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('leads_simulador', 'nome');
  },
};
