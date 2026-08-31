// models/ImpostoEstimativa.js
// Snapshot IMUTÁVEL da estimativa de imposto de uma cotação: guarda tudo que
// justifica o valor cobrado (commodities enviadas, câmbio congelado, camadas,
// request/response cru da fonte + hash). Nunca é atualizado — se a regra mudar,
// cria-se uma linha nova.
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const ImpostoEstimativa = sequelize.define('ImpostoEstimativa', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

        cotacao_id: { type: DataTypes.INTEGER, allowNull: false },
        cliente_id: { type: DataTypes.INTEGER, allowNull: false },

        provider: { type: DataTypes.STRING(32), allowNull: false },
        incoterm: { type: DataTypes.STRING(8), allowNull: true },
        pais_origem: { type: DataTypes.STRING(2), allowNull: true },
        pais_destino: { type: DataTypes.STRING(2), allowNull: true },
        moeda: { type: DataTypes.STRING(3), allowNull: true },

        commodities_snapshot: { type: DataTypes.JSONB, allowNull: true },

        imposto_usd_base: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
        margem_pct: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
        imposto_usd_com_margem: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
        fx_usado: { type: DataTypes.DECIMAL(10, 4), allowNull: true },
        fx_fonte: { type: DataTypes.STRING(32), allowNull: true },
        colchao_cambio_pct: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
        imposto_valor_brl: { type: DataTypes.DECIMAL(12, 2), allowNull: true },

        breakdown: { type: DataTypes.JSONB, allowNull: true },
        de_minimis: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        is_estimate: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        modo: { type: DataTypes.STRING(16), allowNull: true },

        raw_request: { type: DataTypes.JSONB, allowNull: true },
        raw_response: { type: DataTypes.JSONB, allowNull: true },
        hash: { type: DataTypes.STRING(64), allowNull: true },
    }, {
        tableName: 'imposto_estimativas',
        underscored: true,
        timestamps: true,
        updatedAt: false,
        indexes: [
            { fields: ['cotacao_id'] },
            { fields: ['cliente_id'] },
            { fields: ['created_at'] },
        ],
    });

    ImpostoEstimativa.associate = (models) => {
        if (models.Cotacao) {
            ImpostoEstimativa.belongsTo(models.Cotacao, {
                foreignKey: 'cotacao_id',
                as: 'cotacao',
                constraints: false,
            });
        }
    };

    return ImpostoEstimativa;
};
