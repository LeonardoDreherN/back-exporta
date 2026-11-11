'use strict';

/**
 * Configuração por cliente do imposto no checkout.
 *
 * impostoPctVisivel      quanto do imposto aparece para o comprador; o resto
 *                        vai embutido no preço. As duas partes somam o
 *                        imposto cheio.
 * faturamentoFatorPadrao fração do preço de venda usada como valor declarado
 *                        quando o SKU não está em faturamento_skus.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Clientes', 'impostoPctVisivel', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 50,
    });

    await queryInterface.addColumn('Clientes', 'faturamentoFatorPadrao', {
      type: Sequelize.DECIMAL(5, 4),
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Clientes', 'impostoPctVisivel');
    await queryInterface.removeColumn('Clientes', 'faturamentoFatorPadrao');
  },
};
