'use strict';

// Bloqueio de operação, separado da suspensão de acesso.
//
// `status` barra o login: a pessoa não entra. Isso é forte demais quando o
// problema é comercial (inadimplência, pendência de documento) e você ainda
// quer que ela veja os envios em andamento, baixe etiqueta do que já despachou
// e fale com o suporte. `enviosBloqueados` entra nesse meio: acessa, mas não
// cria cotação nem despacha.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Clientes', 'enviosBloqueados', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    // Aparece para o cliente na tela, então é escrito para ele ler, não para
    // registro interno.
    await queryInterface.addColumn('Clientes', 'enviosBloqueadosMotivo', {
      type: Sequelize.STRING(200),
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn('Clientes', 'enviosBloqueadosEm', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Clientes', 'enviosBloqueadosEm');
    await queryInterface.removeColumn('Clientes', 'enviosBloqueadosMotivo');
    await queryInterface.removeColumn('Clientes', 'enviosBloqueados');
  },
};
