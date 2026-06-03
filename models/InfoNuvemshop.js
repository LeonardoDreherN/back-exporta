const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const InfoNuvemshop = sequelize.define('InfoNuvemshop', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        storeId: { type: DataTypes.BIGINT, allowNull: false, unique: true },
        id_cliente: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'Clientes', key: 'id' },
        },
    }, { tableName: 'info_nuvemshop' });

    return InfoNuvemshop;
};
