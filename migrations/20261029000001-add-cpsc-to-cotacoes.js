'use strict';

// Formulário CPSC da cotação.
//
// O despachante passou a pedir o "Goods Not Registered / Certificate of
// Compliance Form" no desembaraço e ele era preenchido à mão, um por item.
// Agora é emitido pela Intrex com os dados da cotação, e o PDF vai para o
// mesmo bucket da invoice — por isso aqui só entram os três campos que
// apontam para o arquivo, sem bucket novo para criar no Supabase.
//
// Nada aqui guarda o conteúdo declarado (código de disclaim, produto
// infantil, laboratório): o formulário é regerável e essas respostas são de
// quem assina, então viajam na requisição e não viram estado.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('cotacoes', 'cpsc_path', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('cotacoes', 'cpsc_created_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('cotacoes', 'cpsc_mime', {
      type: Sequelize.STRING(32),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('cotacoes', 'cpsc_mime');
    await queryInterface.removeColumn('cotacoes', 'cpsc_created_at');
    await queryInterface.removeColumn('cotacoes', 'cpsc_path');
  },
};
