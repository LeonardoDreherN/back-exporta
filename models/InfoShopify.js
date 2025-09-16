const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const InfoShopify = sequelize.define('InfoShopify', {

        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        shopDomain: { type: DataTypes.STRING, allowNull: false, unique: true },
        id_cliente: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'Clientes', key: 'id' },
        },
        apiVersion: { type: DataTypes.STRING, allowNull: false, defaultValue: '2025-07' }, // nova coluna
    });

    return InfoShopify;
};
