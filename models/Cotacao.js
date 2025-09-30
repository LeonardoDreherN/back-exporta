const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Cotacao = sequelize.define('Cotacao', {

        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        cliente_id: { type: DataTypes.INTEGER, allowNull: false },

        // // campos que você já tem
        // moeda_emissao: { type: DataTypes.STRING(10) },
        // moeda_pagamento: { type: DataTypes.STRING(10) },
        pais_remetente: { type: DataTypes.STRING(2) },
        pais_dest: { type: DataTypes.STRING(2) },
        pedido_ref: { type: DataTypes.STRING, allowNull: false },

        pedido: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
        caixa: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
        tableName: 'cotacoes',
        underscored: true,
        timestamps: true,
        indexes: [
            { fields: ['cliente_id', 'created_at'] },
            { fields: ['pedido'], using: 'gin', operator: 'jsonb_path_ops' },
            { unique: true, fields: ['cliente_id', 'pedido_ref'] }
        ],
    });

    Cotacao.associate = (models) => {
        if (models.Cliente) {
            Cotacao.belongsTo(models.Cliente, { foreignKey: 'cliente_id', as: 'cliente' });
        }
        // ⚠️ Se você ainda usa a relação com Caixas (models/Caixas.js),
        // pode manter somente para "lookup". O snapshot "caixa" é a verdade.
        if (models.Caixas) {
            Cotacao.belongsTo(models.Caixas, { foreignKey: 'caixa_id', as: 'caixaRel', constraints: false });
        }
    };

    return Cotacao
};
