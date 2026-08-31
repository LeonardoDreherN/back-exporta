'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('imposto_estimativas', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },

      cotacao_id: { type: Sequelize.INTEGER, allowNull: false },
      cliente_id: { type: Sequelize.INTEGER, allowNull: false },

      provider: { type: Sequelize.STRING(32), allowNull: false },
      incoterm: { type: Sequelize.STRING(8), allowNull: true },
      pais_origem: { type: Sequelize.STRING(2), allowNull: true },
      pais_destino: { type: Sequelize.STRING(2), allowNull: true },
      moeda: { type: Sequelize.STRING(3), allowNull: true },

      commodities_snapshot: { type: Sequelize.JSONB, allowNull: true },

      imposto_usd_base: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      margem_pct: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
      imposto_usd_com_margem: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      fx_usado: { type: Sequelize.DECIMAL(10, 4), allowNull: true },
      fx_fonte: { type: Sequelize.STRING(32), allowNull: true },
      colchao_cambio_pct: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
      imposto_valor_brl: { type: Sequelize.DECIMAL(12, 2), allowNull: true },

      breakdown: { type: Sequelize.JSONB, allowNull: true },
      de_minimis: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      is_estimate: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      modo: { type: Sequelize.STRING(16), allowNull: true },

      raw_request: { type: Sequelize.JSONB, allowNull: true },
      raw_response: { type: Sequelize.JSONB, allowNull: true },
      hash: { type: Sequelize.STRING(64), allowNull: true },

      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });

    await queryInterface.addIndex('imposto_estimativas', ['cotacao_id']);
    await queryInterface.addIndex('imposto_estimativas', ['cliente_id']);
    await queryInterface.addIndex('imposto_estimativas', ['created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('imposto_estimativas');
  },
};
