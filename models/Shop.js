const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Shop = sequelize.define('Shop', {
        shop: { type: DataTypes.STRING, primaryKey: true, unique: true },
        accessToken: { type: DataTypes.TEXT, allowNull: false },
        refreshToken: { type: DataTypes.TEXT }, // 👈 NOVO
        tokenExpiresAt: { type: DataTypes.DATE }, // 👈 NOVO
        scope: { type: DataTypes.TEXT },
    });
    return Shop;
};