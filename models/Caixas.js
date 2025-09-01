const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Caixa = sequelize.define('Caixa', {
    
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      cod_identificacao: { type: DataTypes.STRING, allowNull: false },
      descricao: { type: DataTypes.STRING, allowNull: false },
      altura: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      largura: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      profundidade: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      peso: { type: DataTypes.DECIMAL(10, 3), allowNull: false },
      id_cliente: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Clientes', key: 'id' },
      },
    },
    {
      indexes: [
        {
          unique: true,
          name: 'caixas_cliente_cod_uq',
          fields: ['id_cliente', 'cod_identificacao'], // ordem IMPORTA
        },
      ],
    }
  );

  Caixa.associate = (models) => {
    // Relação por CÓDIGO (sem FK de banco)
    Caixa.hasMany(models.Produto, {
      foreignKey: 'cod_identificacao',
      sourceKey: 'cod_identificacao',
      as: 'ProdutosPorCodigo',
      constraints: false,
    });

    // Inversa (Produto -> Caixa por código)
    models.Produto.belongsTo(models.Caixa, {
      foreignKey: 'cod_identificacao',
      targetKey: 'cod_identificacao',
      as: 'CaixaPorCodigo',
      constraints: false,
    });
  };

  return Caixa;
};
