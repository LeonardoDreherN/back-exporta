'use strict';

/**
 * Interruptor do imposto no checkout, por loja.
 *
 * Nasce desligado. Sem o valor faturado de cada SKU cadastrado, o cálculo cai
 * no preço de venda e cobra várias vezes o imposto real — foi o que aconteceu
 * em 11/11/2026, quando a funcionalidade subiu valendo para as 14 lojas de
 * uma vez. Liga-se loja a loja, depois do cadastro conferido.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Clientes', 'impostoCheckoutAtivo', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('Clientes', 'impostoCheckoutAtivadoEm', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Clientes', 'impostoCheckoutAtivadoEm');
    await queryInterface.removeColumn('Clientes', 'impostoCheckoutAtivo');
  },
};
