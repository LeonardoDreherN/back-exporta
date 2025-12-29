// models/Shipment.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Shipment = sequelize.define(
        'Shipment',
        {
            id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },

            // ✅ trava 1 envio por pedido
            cliente_id: { type: DataTypes.INTEGER, allowNull: false },
            pedido_ref: { type: DataTypes.STRING, allowNull: false },

            // liga ao registro final
            cotacao_id: { type: DataTypes.INTEGER, allowNull: true },

            // campos antigos (mantidos)
            user_id: { type: DataTypes.BIGINT },
            shop_id: { type: DataTypes.BIGINT },

            rate_result: { type: DataTypes.JSONB },  // pode guardar o "chosen" + debug
            ship_result: { type: DataTypes.JSONB },
            track_result: { type: DataTypes.JSONB },

            carrier: { type: DataTypes.STRING },
            status: { type: DataTypes.STRING },
            serviceCode: { type: DataTypes.STRING(64), allowNull: true },
        },
        {
            tableName: 'shipments',
            underscored: true,
        }
    );

    Shipment.associate = (models) => {
        if (models.Cotacao) {
            Shipment.belongsTo(models.Cotacao, { foreignKey: 'cotacao_id', as: 'cotacao' });
        }
        if (models.Cliente) {
            Shipment.belongsTo(models.Cliente, { foreignKey: 'cliente_id', as: 'cliente' });
        }
    };

    return Shipment;
};
