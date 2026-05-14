'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('pedidos_importados', 'shopify_order_id', {
      type: Sequelize.BIGINT,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('pedidos_importados', 'shopify_order_id');
  },
};
