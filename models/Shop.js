const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Shop = sequelize.define('Shop', {
        shop: {
            type: DataTypes.STRING,
            primaryKey: true,
            unique: true,
        },
        accessToken: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        refreshToken: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        tokenExpiresAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        scope: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    });

    return Shop;
};