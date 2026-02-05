const { Sequelize } = require('sequelize');
const ClienteModel = require('./Cliente.js');
const CaixaModel = require('./Caixas.js')
const ProdutoModel = require('./Produtos.js')
const ShopModel = require('./Shop.js');
const ShopClientModel = require('./ShopClient.js'); // ✅ ADD
const InfoShopifyModel = require('./InfoShopify.js');
const CotacaoModel = require('./Cotacao.js');
const PedidoImportModel = require('./PedidoImport.js');
const ShipmentModel = require('./Shipment.js');
const AsaasBoletosModel = require('./AsaasBoletos.js');

require('dotenv/config');

// Inicializa Sequelize
// console.log('SUPABASE_DB_URL EM USO:', process.env.SUPABASE_DB_URL);
const sequelize = new Sequelize(
  process.env.SUPABASE_DB_URL,
  {
    dialect: 'postgres',
    logging: false,
    pool: { min: 0, max: 5, idle: 10000, acquire: 30000 },
    port: Number(process.env.DB_PORT) || 5432, // ⚠️ use 5432 como padrão
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
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
   ShopClient: ShopClientModel(sequelize), // ✅ ADD
  // InfoShopify: InfoShopifyModel(sequelize),
  Cotacao: CotacaoModel(sequelize),
  PedidoImport: PedidoImportModel(sequelize),
  AsaasBoletos: AsaasBoletosModel(sequelize),
  Shipment: ShipmentModel(sequelize),
};

module.exports = db;
