const { DataTypes } = require("sequelize");

// models/PedidoImport.js
module.exports = (sequelize) => {
    const PedidoImport = sequelize.define('PedidoImport', {
        cliente_id: { type: DataTypes.INTEGER, allowNull: false },
        pedido_ref: { type: DataTypes.STRING, allowNull: false },
        moeda: { type: DataTypes.STRING(10) },
        total: { type: DataTypes.DECIMAL(12, 2) },
        nomeComprador: { type: DataTypes.STRING },
        emailComprador: { type: DataTypes.STRING },
        telefoneComprador: { type: DataTypes.STRING },
        cidade: { type: DataTypes.STRING },
        estado: { type: DataTypes.STRING },
        CEP: { type: DataTypes.STRING },
        pais: { type: DataTypes.STRING },
        itens: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    }, {
        tableName: 'pedidos_importados',
        underscored: true,   // => created_at / updated_at no banco
        timestamps: true,
        indexes: [
            { unique: true, fields: ['cliente_id', 'pedido_ref'] },
            { fields: ['cliente_id', 'created_at'] }, // <- nome correto da coluna
        ],
    });
    return PedidoImport;
};
