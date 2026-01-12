'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('cotacoes', 'status_pagamento', {
      type: Sequelize.ENUM('NAOGERADO', 'GERADO'),
      allowNull: true,
      defaultValue: null,
    })

    await queryInterface.sequelize.query(`
        UPDATE cotacoes
        SET status_pagamento = 'NAOGERADO'
        WHERE carrier = 'FEDEX' AND status_pagamento IS NULL
      `)
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('cotacoes', 'status_pagamento');
  }
};
