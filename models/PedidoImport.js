const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    return sequelize.define('PedidoImport', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

        cliente_id: { type: DataTypes.STRING, allowNull: false, field: 'cliente_id' },
        pedido_ref: { type: DataTypes.STRING, allowNull: false, field: 'pedido_ref' },

        origem: { type: DataTypes.STRING, allowNull: true, defaultValue: 'CSV', field: 'origem' },

        moeda: { type: DataTypes.STRING, allowNull: true, field: 'moeda' },
        total: { type: DataTypes.DECIMAL(12, 2), allowNull: true, field: 'total' },

        nomeComprador: { type: DataTypes.STRING, allowNull: true, field: 'nome_comprador' },
        emailComprador: { type: DataTypes.STRING, allowNull: true, field: 'email_comprador' },
        telefoneComprador: { type: DataTypes.STRING, allowNull: true, field: 'telefone_comprador' },

        endereco: { type: DataTypes.STRING, allowNull: true, field: 'endereco' },
        cidade: { type: DataTypes.STRING, allowNull: true, field: 'cidade' },
        estado: { type: DataTypes.STRING, allowNull: true, field: 'estado' },
        CEP: { type: DataTypes.STRING, allowNull: true, field: 'cep' },
        pais: { type: DataTypes.STRING, allowNull: true, field: 'pais' },

        itens: { type: DataTypes.JSON, allowNull: true, field: 'itens' },
        raw_json: { type: DataTypes.JSON, allowNull: true, field: 'raw_json' },
    }, {
        tableName: 'pedidos_importados',
        underscored: true,
        timestamps: true,
        indexes: [
            { unique: true, fields: ['cliente_id', 'pedido_ref'] }, // impede duplicar D5 no mesmo cliente
            { fields: ['cliente_id'] },
            { fields: ['email_comprador'] }, // <-- snake_case
            { fields: ['cidade'] },
            { fields: ['pais'] },
        ],
    });
};
