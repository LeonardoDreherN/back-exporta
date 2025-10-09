// models/Shipment.js
const { DataTypes } = require('sequelize')

module.exports = (sequelize) => {
    const Shipment = sequelize.define('Shipment', {
        user_id: { type: DataTypes.BIGINT },
        shop_id: { type: DataTypes.BIGINT },
        rate_result: { type: DataTypes.JSONB },
        ship_result: { type: DataTypes.JSONB },
        track_result: { type: DataTypes.JSONB },
        carrier: { type: DataTypes.STRING },
        status: { type: DataTypes.STRING }
    }, {
        tableName: 'shipments',
        underscored: true
    });
    return Shipment;
};
