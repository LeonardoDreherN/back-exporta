require('dotenv').config();

const common = {
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false,
        },
    },
};

module.exports = {
    development: {
        url: process.env.SUPABASE_DB_URL,
        ...common,
    },
    test: {
        url: process.env.SUPABASE_DB_URL,
        ...common,
    },
    production: {
        url: process.env.SUPABASE_DB_URL,
        ...common,
    },
};
