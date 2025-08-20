const { Sequelize } = require('sequelize')
const { config } = require('dotenv')

config();

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

module.exports = sequelize;