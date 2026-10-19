// models/RegimeImportacao.js
// O regime tarifário vigente de um país de destino: quais medidas valem hoje
// para mercadoria brasileira entrando lá.
//
// Existe porque essa pergunta é a MESMA para todas as remessas do mesmo
// destino, e era redescoberta do zero a cada cotação — com respostas
// diferentes no mesmo dia (uma aplicou a Seção 301 de 25%, outra não).
// Resolvida uma vez, com orçamento alto e fonte primária, e reaproveitada.
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const RegimeImportacao = sequelize.define('RegimeImportacao', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

        pais_destino: { type: DataTypes.STRING(2), allowNull: false },
        pais_origem: { type: DataTypes.STRING(2), allowNull: false, defaultValue: 'BR' },

        // Parágrafo curto, em português, para leitura humana na aprovação.
        resumo: { type: DataTypes.TEXT, allowNull: true },

        // [{ medida, tipo, aliquota_pct, base, em_vigor_desde, expira_em,
        //    aplica_a, fonte_primaria }]
        medidas: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },

        // Limite de de minimis do destino e se está suspenso.
        de_minimis: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },

        // Imposto sobre consumo (VAT/GST) que incide na importação.
        imposto_consumo: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },

        fontes: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
        confianca: { type: DataTypes.STRING(8), allowNull: true },

        // Quantas rodadas independentes foram feitas e se elas concordaram.
        // Divergência aqui é o sinal mais forte de que precisa olho humano.
        rodadas: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
        divergencias: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },

        // 'pendente' -> pesquisado, esperando conferência
        // 'aprovado' -> liberado para cobrar
        // 'rejeitado' -> descartado, não usar
        status: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'pendente' },
        aprovado_por: { type: DataTypes.STRING(120), allowNull: true },
        aprovado_em: { type: DataTypes.DATE, allowNull: true },

        // Depois disso o regime é considerado velho e precisa nova pesquisa.
        valido_ate: { type: DataTypes.DATE, allowNull: true },

        raw: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
    }, {
        tableName: 'regimes_importacao',
        underscored: true,
        timestamps: true,
        indexes: [
            { fields: ['pais_destino', 'status'] },
            { fields: ['valido_ate'] },
        ],
    });

    return RegimeImportacao;
};
