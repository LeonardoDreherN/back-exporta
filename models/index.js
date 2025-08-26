const { Sequelize } = require('sequelize');
const ClienteModel = require('./Cliente.js');
const CaixaModel = require('./Caixas.js')
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
  Caixa: CaixaModel(sequelize)
};

module.exports = db;
