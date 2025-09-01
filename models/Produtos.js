const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Produto = sequelize.define('Produto', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

        sku: { type: DataTypes.STRING, allowNull: false },
        nome: { type: DataTypes.STRING, allowNull: false },
        descricao: { type: DataTypes.STRING, allowNull: false },
        pais_origem: { type: DataTypes.STRING, allowNull: false },
        categoria: { type: DataTypes.STRING, allowNull: false },
        hscode: { type: DataTypes.STRING, allowNull: false },

        altura: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
        largura: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
        profundidade: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
        peso: { type: DataTypes.DECIMAL(10, 3), allowNull: false },

        // Produto SEMPRE pertence a um cliente
        id_cliente: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'Clientes', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
        },

        // RELAÇÃO POR CÓDIGO (sem FK de banco porque cod_identificacao não é único sozinho)
        cod_identificacao: {
            type: DataTypes.STRING,
            allowNull: true,
            // IMPORTANTE: não colocar "references" aqui!
        },
    }, {
        indexes: [
            { unique: true, name: 'produtos_cliente_sku_uq', fields: ['id_cliente', 'sku'] },
            { unique: true, name: 'produtos_cliente_nome_uq', fields: ['id_cliente', 'nome'] },
        ],
    });

    Produto.associate = (models) => {
        // Produto -> Cliente
        Produto.belongsTo(models.Cliente, {
            foreignKey: { name: 'id_cliente', allowNull: false },
            as: 'Cliente',
        });

        // Produto -> Caixa por CÓDIGO (sem FK de DB; apenas relação lógica)
        Produto.belongsTo(models.Caixa, {
            foreignKey: { name: 'cod_identificacao', allowNull: true }, // coluna em Produtos
            targetKey: 'cod_identificacao',                              // coluna em Caixas
            as: 'CaixaPorCodigo',
            constraints: false, // evita o Sequelize tentar criar FK inválida
        });
    };

    return Produto;
};
