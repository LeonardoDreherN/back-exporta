const { Sequelize } = require('sequelize');
const ClienteModel = require('./Cliente.js');
const CaixaModel = require('./Caixas.js')
const ProdutoModel = require('./Produtos.js')
const ShopModel = require('./Shop.js');
const InfoShopifyModel = require('./InfoShopify.js');
const CotacaoModel = require('./Cotacao.js');
const PedidoImportModel = require('./PedidoImport.js');
const ShipmentModel = require('./Shipment.js');

require('dotenv/config');

// Inicializa Sequelize
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  String(process.env.DB_PASS),
  {
    host: process.env.DB_HOST,
    dialect: 'postgres',
    logging: false,
    port: Number(process.env.DB_PORT) || 5432 // ⚠️ use 5432 como padrão
  }
);

// Models
const db = {
  Sequelize,
  sequelize,
  Cliente: ClienteModel(sequelize),
  Caixa: CaixaModel(sequelize),
  Produto: ProdutoModel(sequelize),
  Shop: ShopModel(sequelize),
  InfoShopify: InfoShopifyModel(sequelize),
  Cotacao: CotacaoModel(sequelize),
  PedidoImport: PedidoImportModel(sequelize),
  Shipment: ShipmentModel(sequelize)
};

module.exports = db;
