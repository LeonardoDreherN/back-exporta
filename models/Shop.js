const DataTypes = require('sequelize')

// models/Shop.js

module.exports = (sequelize) => {
    const Shop = sequelize.define('Shop', {
        shop: { type: DataTypes.STRING, primaryKey: true, unique: true },      // ex: thiago123456.myshopify.com
        accessToken: { type: DataTypes.TEXT, allowNull: false },
        scope: { type: DataTypes.TEXT },
    });
    return Shop;
}