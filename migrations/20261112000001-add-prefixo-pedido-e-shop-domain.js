'use strict';

/**
 * Duas lojas Shopify na mesma conta Intrex colidem no numero do pedido: a
 * Shopify numera por loja, entao as duas chegam ao 1007. O UNIQUE
 * (cliente_id, pedido_ref) de pedidos_importados fazia o segundo 1007 ser
 * descartado em silencio (skipped), e o SyncLog ainda registrava "ok".
 *
 * prefixoPedido: opcional, por loja. NULL mantem o comportamento atual (ref
 * crua), para nao mudar o historico de quem ja opera com uma loja so. A loja
 * nova do mesmo cliente recebe prefixo e passa a gravar MOMI-1007.
 *
 * shop_domain: de qual loja o pedido veio. Sem isso o auto-fulfill pegava
 * "uma loja qualquer" do cliente (InfoShopify.findOne por id_cliente) e
 * mandava o rastreio para a loja errada.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('InfoShopifies', 'prefixoPedido', {
      type: Sequelize.STRING(8),
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn('pedidos_importados', 'shop_domain', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('pedidos_importados', 'shop_domain');
    await queryInterface.removeColumn('InfoShopifies', 'prefixoPedido');
  },
};
