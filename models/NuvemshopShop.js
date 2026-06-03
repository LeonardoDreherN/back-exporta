const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const NuvemshopShop = sequelize.define('NuvemshopShop', {
        storeId: { type: DataTypes.BIGINT, primaryKey: true },
        accessToken: { type: DataTypes.STRING(512), allowNull: false },
        scope: { type: DataTypes.TEXT, allowNull: true },
    }, { tableName: 'nuvemshop_shops' });

    return NuvemshopShop;
};
