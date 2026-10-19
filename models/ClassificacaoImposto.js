// models/ClassificacaoImposto.js
// Cache da classificação fiscal de um item num destino.
//
// O que se guarda é a ALÍQUOTA, não o valor: alíquota não depende de quanto a
// remessa vale, então uma classificação serve para infinitas simulações do
// mesmo produto. É isso que permite ligar a estimativa no simulador — onde
// qualquer cliente simula quantas vezes quiser — sem torneira aberta.
//
// A chave inclui o regime_id: quando o regime do país muda, toda a cache
// daquele país deixa de ser encontrada sozinha, sem precisar limpar nada.
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const ClassificacaoImposto = sequelize.define('ClassificacaoImposto', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

        pais_destino: { type: DataTypes.STRING(2), allowNull: false },
        regime_id: { type: DataTypes.INTEGER, allowNull: false },

        // NCM normalizado (só dígitos) quando informado; senão, hash da
        // descrição. Produto sem NCM ainda se repete entre simulações.
        chave_item: { type: DataTypes.STRING(64), allowNull: false },
        ncm: { type: DataTypes.STRING(16), allowNull: true },
        descricao: { type: DataTypes.STRING(200), allowNull: true },

        // Faixa de valor: de minimis e entrada formal/informal criam degraus,
        // então a mesma alíquota não vale para qualquer valor.
        faixa: { type: DataTypes.STRING(24), allowNull: false },

        // Parte proporcional ao valor.
        aliquota_importacao_pct: { type: DataTypes.DECIMAL(6, 2), allowNull: false, defaultValue: 0 },
        aliquota_consumo_pct: { type: DataTypes.DECIMAL(6, 2), allowNull: false, defaultValue: 0 },

        // Parte fixa, que não escala com o valor (MPF e afins).
        taxas_fixas_usd: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },

        medidas_aplicadas: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
        confianca: { type: DataTypes.STRING(8), allowNull: true },
        observacoes: { type: DataTypes.TEXT, allowNull: true },

        custo_usd: { type: DataTypes.DECIMAL(8, 4), allowNull: true },
        usos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    }, {
        tableName: 'classificacoes_imposto',
        underscored: true,
        timestamps: true,
        indexes: [
            { unique: true, fields: ['regime_id', 'chave_item', 'faixa'] },
            { fields: ['pais_destino'] },
        ],
    });

    return ClassificacaoImposto;
};
