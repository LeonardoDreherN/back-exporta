const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Cotacao = sequelize.define('Cotacao', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

        // Tenant
        cliente_id: { type: DataTypes.STRING, allowNull: false },

        // Identificação da cotação (única por cliente)
        quote_id: { type: DataTypes.STRING, allowNull: false },

        carrier: { type: DataTypes.STRING, allowNull: false, defaultValue: 'MockCarrier' },

        // Liga com o pedido importado do MESMO cliente
        pedido_ref: { type: DataTypes.STRING, allowNull: false }, // ex.: "D5"
        // IDs das caixas selecionadas (do MESMO cliente). Se você hidratar inline, pode deixar null.
        caixa_ids: { type: DataTypes.JSON, allowNull: true }, // [1,2,3]

        // parâmetros do frete
        moeda_emissao: { type: DataTypes.STRING, allowNull: false },
        moeda_pagamento: { type: DataTypes.STRING, allowNull: false },
        pais_remetente: { type: DataTypes.STRING, allowNull: false },
        pais_dest: { type: DataTypes.STRING, allowNull: false },

        quantidade_caixas: { type: DataTypes.INTEGER, allowNull: false },

        // totais
        preco_total: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        preco_total_moeda_pagamento: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        peso_taxavel_total_kg: { type: DataTypes.DECIMAL(12, 2), allowNull: false },

        // snapshots (auditoria)
        pedido_snapshot: { type: DataTypes.JSON, allowNull: true },
        caixas_snapshot: { type: DataTypes.JSON, allowNull: true },
        breakdown: { type: DataTypes.JSON, allowNull: false },

        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
        tableName: 'cotacoes',
        underscored: true,
        timestamps: false,
        indexes: [
            // Unicidade por cliente
            { unique: true, fields: ['cliente_id', 'quote_id'] },
            { fields: ['cliente_id'] },
            { fields: ['created_at'] },
            { fields: ['pais_dest'] },
            { fields: ['moeda_emissao'] },
            { fields: ['cliente_id', 'pedido_ref'] },
        ],
    });

    return Cotacao
};
