const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const CotacaoCaixa = sequelize.define('CotacaoCaixa', {
        cotacao_id: { type: DataTypes.INTEGER, allowNull: false },

        // referência à tabela Caixa já existente
        caixa_id: { type: DataTypes.INTEGER, allowNull: false },

        // identifica a "instância" escolhida no front (permite repetir a mesma caixa)
        entry_uid: { type: DataTypes.STRING, allowNull: false },

        // cópia dos dados principais (congela o estado)
        cod_identificacao: { type: DataTypes.STRING, allowNull: false },
        descricao: { type: DataTypes.STRING, allowNull: false },

        profundidade_cm: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
        largura_cm: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
        altura_cm: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
        peso_kg: { type: DataTypes.DECIMAL(10, 3), allowNull: false },

        valor_moeda: { type: DataTypes.STRING(10) },
        valor_valor: { type: DataTypes.DECIMAL(12, 2) },

        // snapshot livre da caixa
        caixa_snapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
        tableName: 'cotacao_caixas',
        underscored: true,
        timestamps: true,
        indexes: [
            { fields: ['cotacao_id'] },
            // NÃO coloque unique em (cotacao_id, caixa_id) para permitir duplicatas
        ],
    });

    return CotacaoCaixa;
};
