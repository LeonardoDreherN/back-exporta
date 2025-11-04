// models/CotacaoPagamento.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const CotacaoPagamento = sequelize.define('CotacaoPagamento', {
        id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
        cliente_id: { type: DataTypes.BIGINT, allowNull: false },
        cotacao_id: { type: DataTypes.BIGINT, allowNull: false },
        pedido_ref: { type: DataTypes.STRING, allowNull: true },

        currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'USD' },
        amount_base: DataTypes.DECIMAL(14, 2),
        amount_service_options: DataTypes.DECIMAL(14, 2),
        amount_itemized: DataTypes.DECIMAL(14, 2),
        amount_discount: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
        amount_fees_gateway: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
        amount_total: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
        amount_paid: DataTypes.DECIMAL(14, 2),

        status: { type: DataTypes.ENUM('PENDING', 'PAID', 'REFUNDED', 'FAILED'), defaultValue: 'PENDING' },
        method: { type: DataTypes.ENUM('PIX', 'CARD', 'INVOICE', 'WIRE', 'OTHER') },
        external_tx_id: DataTypes.STRING,
        notes: DataTypes.TEXT,

        paid_at: DataTypes.DATE,
    }, {
        tableName: 'cotacao_pagamentos',
        underscored: true,
        timestamps: true
    });

    CotacaoPagamento.associate = (models) => {
        if (models.Cotacao) {
            CotacaoPagamento.belongsTo(models.Cotacao, { foreignKey: 'cotacao_id', as: 'cotacao' });
        }
        if (models.Cliente) {
            CotacaoPagamento.belongsTo(models.Cliente, { foreignKey: 'cliente_id', as: 'cliente' });
        }
    };

    return CotacaoPagamento;
};
