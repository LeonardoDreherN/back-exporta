const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const InfoShopify = sequelize.define('InfoShopify', {

        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        shopifyApiKey: { type: DataTypes.STRING, allowNull: false, unique: true },
        shopifyApiSecret: { type: DataTypes.STRING, allowNull: false, unique: true },
        apiVersion: { type: DataTypes.STRING, allowNull: false },
        shopDomain: { type: DataTypes.STRING, allowNull: false, unique: true },
        id_cliente: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'Clientes', key: 'id' },
        },
    },
        {
            indexes: [
                {
                    unique: true,
                    name: 'info_cliente_cod_uq',
                    fields: ['id_cliente', 'shopifyApiKey'],
                },
            ],
        }
    );

    return InfoShopify;
};
