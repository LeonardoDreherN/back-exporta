'use strict';

// A tabela de boletos nasceu do sync() do Sequelize, entao o nome dela segue a
// pluralizacao do model ("AsaasBoletos") e nao o padrao snake_case das outras.
// Em vez de fixar um chute, procura o nome real antes de alterar.
async function acharTabelaBoletos(queryInterface) {
  const [linhas] = await queryInterface.sequelize.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND lower(replace(table_name, '_', '')) = 'asaasboletos'
    LIMIT 1
  `);

  const nome = linhas?.[0]?.table_name;
  if (!nome) {
    throw new Error(
      'Tabela de boletos do Asaas nao encontrada no schema public. ' +
      'Confira o nome real antes de rodar esta migration.'
    );
  }
  return nome;
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tabela = await acharTabelaBoletos(queryInterface);

    // Sem este vinculo o banco nao sabe qual cotacao um boleto cobriu: a linha
    // so apontava para o cliente. Era o que permitia a mesma cotacao entrar no
    // boleto em lote depois de ja ter sido cobrada no boleto com impostos.
    await queryInterface.addColumn(tabela, 'cotacaoId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: null,
    });

    await queryInterface.addIndex(tabela, ['cotacaoId'], {
      name: 'asaas_boletos_cotacao_id_idx',
    });
  },

  async down(queryInterface) {
    const tabela = await acharTabelaBoletos(queryInterface);
    await queryInterface.removeIndex(tabela, 'asaas_boletos_cotacao_id_idx');
    await queryInterface.removeColumn(tabela, 'cotacaoId');
  },
};
