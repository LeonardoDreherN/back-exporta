// models/Cotacao.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Cotacao = sequelize.define('Cotacao', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        cliente_id: { type: DataTypes.INTEGER, allowNull: false },

        pais_remetente: { type: DataTypes.STRING(2) },
        pais_dest: { type: DataTypes.STRING(2) },
        pedido_ref: { type: DataTypes.STRING, allowNull: false },

        // JSONB crus (formato livre)
        pedido: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
        caixa: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

        // ===== NOVOS CAMPOS =====
        // base64 "cru" (PDF/PNG) vindo da UPS; use TEXT para não limitar tamanho
        etiqueta_base64: { type: DataTypes.TEXT, allowNull: true },
        etiqueta_mime: { type: DataTypes.STRING(32), allowNull: true }, // ex.: 'application/pdf', 'image/png'

        invoice_base64: { type: DataTypes.TEXT, allowNull: true },
        invoice_mime: { type: DataTypes.STRING(32), allowNull: true }, // ex.: 'application/pdf'

        // um tracking principal por cotação (se tiver multi-pacote, você pode guardar o master)
        tracking_number: { type: DataTypes.STRING(64), allowNull: true },
    }, {
        tableName: 'cotacoes',
        underscored: true,
        timestamps: true,
        indexes: [
            { fields: ['cliente_id', 'created_at'] },
            { fields: ['pedido'], using: 'gin' },
            { unique: true, fields: ['cliente_id', 'pedido_ref'] },
            // busca rápida por tracking
            { fields: ['tracking_number'] },
        ],
    });

    Cotacao.associate = (models) => {
        if (models.Cliente) {
            Cotacao.belongsTo(models.Cliente, { foreignKey: 'cliente_id', as: 'cliente' });
        }
        if (models.Caixas) {
            Cotacao.belongsTo(models.Caixas, { foreignKey: 'caixa_id', as: 'caixaRel', constraints: false });
        }
    };

    return Cotacao;
};
