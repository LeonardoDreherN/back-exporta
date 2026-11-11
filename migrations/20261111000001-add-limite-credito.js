'use strict';

/**
 * Limite de exposição por conta.
 *
 * Clientes.limiteCreditoAtivo       liga a regra NESTA conta (padrão: off)
 * Clientes.nivelConta               nível da conta (1 = nova)
 * Clientes.limiteAbertoUsdOverride  limite em USD que sobrepõe o do nível
 * cotacoes.pago_manual_*            baixa manual de pagamento feita no admin
 *
 * O índice parcial em cotacoes serve à consulta do "em aberto", que roda a
 * cada tentativa de despachar.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Clientes', 'limiteCreditoAtivo', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    await queryInterface.addColumn('Clientes', 'limiteCreditoAtivadoEm', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    });

    await queryInterface.addColumn('Clientes', 'nivelConta', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1,
    });

    await queryInterface.addColumn('Clientes', 'limiteAbertoUsdOverride', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: null,
    });

    await queryInterface.addColumn('cotacoes', 'pago_manual_em', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    });

    await queryInterface.addColumn('cotacoes', 'pago_manual_por', {
      type: Sequelize.STRING(120),
      allowNull: true,
      defaultValue: null,
    });

    await queryInterface.addColumn('cotacoes', 'pago_manual_obs', {
      type: Sequelize.STRING(200),
      allowNull: true,
      defaultValue: null,
    });

    await queryInterface.addIndex('cotacoes', ['cliente_id'], {
      name: 'cotacoes_cliente_em_aberto',
      where: { pago_manual_em: null },
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('cotacoes', 'cotacoes_cliente_em_aberto');
    await queryInterface.removeColumn('cotacoes', 'pago_manual_obs');
    await queryInterface.removeColumn('cotacoes', 'pago_manual_por');
    await queryInterface.removeColumn('cotacoes', 'pago_manual_em');
    await queryInterface.removeColumn('Clientes', 'limiteAbertoUsdOverride');
    await queryInterface.removeColumn('Clientes', 'nivelConta');
    await queryInterface.removeColumn('Clientes', 'limiteCreditoAtivadoEm');
    await queryInterface.removeColumn('Clientes', 'limiteCreditoAtivo');
  },
};
