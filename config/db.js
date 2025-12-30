const { Sequelize } = require('sequelize')
const { config } = require('dotenv')
const { postgres } = require('postgres');

config();

//LOCAL

// const sequelize = new Sequelize(
//   process.env.DB_NAME,
//   process.env.DB_USER,
//   String(process.env.DB_PASS),
//   {
//     host: process.env.DB_HOST,
//     dialect: 'postgres',
//     logging: false,
//     pool: { min: 2, max: 10, idle: 10000, acquire: 30000 },
//     port: Number(process.env.DB_PORT) || 5432 // ⚠️ use 5432 como padrão
//   }
// ); 

//SUPABASE
const connectionString = process.env.SUPABASE_DB_URL;
const sql = postgres(connectionString)


// console.log('SUPABASE_DB_URL EM USO:', process.env.SUPABASE_DB_URL);
const sequelize = new Sequelize(
  process.env.SUPABASE_DB_URL,
  {
    dialect: 'postgres',
    logging: false,
    pool: { min: 2, max: 4, idle: 10000, acquire: 30000 },
    port: Number(process.env.DB_PORT) || 5432, // ⚠️ use 5432 como padrão
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
  }
);

module.exports = {sequelize, sql};
