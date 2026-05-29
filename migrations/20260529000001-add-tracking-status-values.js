"use strict";

// PostgreSQL não permite remover valores de um ENUM — o down é no-op intencional.
const NEW_VALUES = ['EXCECAO', 'CANCELADO', 'RETORNADO', 'SAIU_PARA_ENTREGA', 'COLETADO'];

module.exports = {
  async up(queryInterface) {
    for (const val of NEW_VALUES) {
      await queryInterface.sequelize.query(
        `ALTER TYPE "enum_cotacoes_status_norm" ADD VALUE IF NOT EXISTS '${val}'`
      );
    }
  },

  async down() {
    // ALTER TYPE ... DROP VALUE não é suportado pelo PostgreSQL
  },
};
