'use strict';

// Correção da invoice depois de emitida.
//
// `invoice_ajustes` guarda o que foi corrigido no documento (preço,
// descrição, quantidade) sem tocar em `pedido`. O preço do item alimenta a
// estimativa de imposto, a cotação das transportadoras e o formulário CPSC:
// reescrever o pedido mudaria a base de cálculo de uma remessa já cobrada e
// apagaria o valor declarado na emissão. A invoice passa a ser gerada a
// partir de pedido + ajustes.
//
// `invoice_origem` marca quem emitiu o PDF que está salvo. Só é preenchida
// com 'INTREX' quando nós geramos; invoice vinda da transportadora ou
// anexada à mão fica null, e as que já existiam continuam null porque não há
// como descobrir a origem delas depois do fato. Serve para o admin saber o
// que está substituindo ao reemitir.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('cotacoes', 'invoice_ajustes', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn('cotacoes', 'invoice_origem', {
      type: Sequelize.STRING(16),
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('cotacoes', 'invoice_origem');
    await queryInterface.removeColumn('cotacoes', 'invoice_ajustes');
  },
};
