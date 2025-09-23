const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const PedidoImport = sequelize.define('PedidoImport', {
        // PK técnica (surrogate) para facilitar com Sequelize
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

        // Identificação do cliente (tenant)
        cliente_id: { type: DataTypes.STRING, allowNull: false },

        // Identificação do pedido dentro do cliente (ex.: "D5")
        pedido_ref: { type: DataTypes.STRING, allowNull: false },

        origem: { type: DataTypes.STRING, allowNull: true, defaultValue: 'CSV' },

        // Campos resumidos p/ filtro
        moeda: { type: DataTypes.STRING, allowNull: true },
        total: { type: DataTypes.DECIMAL(12, 2), allowNull: true },

        nomeComprador: { type: DataTypes.STRING, allowNull: true },
        emailComprador: { type: DataTypes.STRING, allowNull: true },
        telefoneComprador: { type: DataTypes.STRING, allowNull: true },

        endereco: { type: DataTypes.STRING, allowNull: true },
        cidade: { type: DataTypes.STRING, allowNull: true },
        estado: { type: DataTypes.STRING, allowNull: true },
        CEP: { type: DataTypes.STRING, allowNull: true },
        pais: { type: DataTypes.STRING, allowNull: true },

        itens: { type: DataTypes.JSON, allowNull: true }, // array de itens
        raw_json: { type: DataTypes.JSON, allowNull: true }, // linhas brutas
    }, {
        underscored: true,
        timestamps: true,
        indexes: [
            // Garante unicidade do pedido por cliente
            { unique: true, fields: ['cliente_id', 'pedido_ref'] },
            { fields: ['cliente_id'] },
            { fields: ['emailComprador'] },
            { fields: ['cidade'] },
            { fields: ['pais'] },
        ],
    });

    return PedidoImport;
};
