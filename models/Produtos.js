const { DataTypes } = require('sequelize')

// Model Empresa
module.exports = (sequelize) => {

    const Produto = sequelize.define('Produto', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        sku: { type: DataTypes.STRING, allowNull: false, unique: true },
        nome: { type: DataTypes.STRING, allowNull: false, unique: true },
        descricao: { type: DataTypes.STRING, allowNull: false },
        pais_origem: { type: DataTypes.STRING, allowNull: false },
        categoria: { type: DataTypes.STRING, allowNull: false },
        hscode: { type: DataTypes.STRING, allowNull: false },
        altura: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
        largura: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
        profundidade: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
        peso: { type: DataTypes.DECIMAL(10, 3), allowNull: false },

        id_cliente: {
            type: DataTypes.INTEGER,
            references: { model: 'Clientes', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
            allowNull: true
        },

        // FK por CÓDIGO (não pelo id)
        cod_identificacao: {
            type: DataTypes.STRING,
            references: { model: 'Caixas', key: 'cod_identificacao' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
            allowNull: true
        }
    });

    Produto.associate = (models) => {
        // Produto pertence a um Cliente (por id_cliente)
        Produto.belongsTo(models.Cliente, {
            foreignKey: 'id_cliente',
            as: 'Cliente'
        });

        // Produto pertence a uma Caixa por CÓDIGO
        Produto.belongsTo(models.Caixa, {
            foreignKey: 'cod_identificacao', // coluna em Produtos
            targetKey: 'cod_identificacao',  // coluna única em Caixas
            as: 'Caixa'
        });
    };

    return Produto;
}
