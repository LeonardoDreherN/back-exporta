'use strict';

// Conta de envio avulso: pessoa física que se cadastra pela página /envio para
// fazer um envio só, sem contrato.
//
// O que muda para ela: paga a remessa antes de a etiqueta existir. Nas contas
// com carteira a etiqueta é emitida e só o download fica travado até pagar;
// para quem não tem relação nenhuma com a Intrex isso deixaria etiquetas
// criadas na transportadora sem ninguém pagando. Ver
// middleware/pagamentoAntesDaEtiqueta.js.
//
// Coluna própria em vez de olhar tipoDocumento === 'cpf': já existem clientes
// CPF no fluxo de empresa (faturados depois), e mudar a regra deles por causa
// desta página quebraria o envio de quem já usa.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Clientes', 'envioAvulso', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Clientes', 'envioAvulso');
  },
};
