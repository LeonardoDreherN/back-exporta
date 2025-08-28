// models/ProdutoLogistico.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const ProdutoLogistico = sequelize.define('ProdutoLogistico', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

        // Multi-loja (opcional, mas recomendado)
        cliente_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'Clientes', key: 'id' },
        },
        // Identificadores vindos da Shopify
        shopify_id: { type: DataTypes.BIGINT, allowNull: false }, // pode ser o ID da variant
        sku: { type: DataTypes.STRING, allowNull: false },

        // Campos da sua tela
        nome_en: { type: DataTypes.STRING(100), allowNull: false },     // "Nome" (inglês)
        descricao: { type: DataTypes.STRING(255), allowNull: false },   // 6–155 chars
        pais_origem_iso2: { type: DataTypes.STRING(2), allowNull: true },
        categoria: { type: DataTypes.STRING, allowNull: true },
        hs_code: { type: DataTypes.STRING(12), allowNull: true },

        altura_cm: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
        largura_cm: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
        profundidade_cm: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
        peso_kg: { type: DataTypes.DECIMAL(10, 3), allowNull: false },

        // Relacionamento com sua Caixa existente (opcional)
        caixa_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'Caixas', key: 'id' } // usa sua tabela existente
        },

        agrupavel: { type: DataTypes.BOOLEAN, defaultValue: false },

        // Auditoria da origem dos dados
        fonte_origem: { type: DataTypes.STRING, allowNull: true }, // 'shopify' | 'manual' | 'metafield'
    }, {
        tableName: 'produtos_logisticos',
        underscored: true,
        timestamps: true,
        indexes: [
            { fields: ['sku'] },
            { unique: true, fields: ['cliente_id', 'shopify_id'] }, // evita duplicata por cliente
        ],
    });

    ProdutoLogistico.associate = (models) => {
        // Relaciona com sua Caixa (sem alterar seu model)
        ProdutoLogistico.belongsTo(models.Caixa, { foreignKey: 'caixa_id' });

        // Se quiser filtrar por cliente diretamente:
        ProdutoLogistico.belongsTo(models.Cliente, { foreignKey: 'cliente_id' });
    };

    return ProdutoLogistico;
};
