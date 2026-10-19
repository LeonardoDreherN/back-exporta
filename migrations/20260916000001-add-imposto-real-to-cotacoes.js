'use strict';

// Imposto REALMENTE cobrado no destino, lançado quando a fatura do desembaraço
// chega. Existe para uma pergunta que hoje não tem resposta: a estimativa está
// acertando? Sem esta coluna a margem de segurança é definida por opinião.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('cotacoes', 'imposto_real_usd', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn('cotacoes', 'imposto_real_brl', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: null,
    });
    // 'fatura_fedex' | 'fatura_ups' | 'manual' — de onde veio o número, para
    // saber o peso de cada linha quando for calibrar a margem.
    await queryInterface.addColumn('cotacoes', 'imposto_real_fonte', {
      type: Sequelize.STRING(32),
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn('cotacoes', 'imposto_real_em', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('cotacoes', 'imposto_real_usd');
    await queryInterface.removeColumn('cotacoes', 'imposto_real_brl');
    await queryInterface.removeColumn('cotacoes', 'imposto_real_fonte');
    await queryInterface.removeColumn('cotacoes', 'imposto_real_em');
  },
};
