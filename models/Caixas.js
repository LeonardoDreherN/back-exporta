const { DataTypes } = require('sequelize')

// Model Empresa
module.exports = (sequelize) => {

  const Caixa = sequelize.define('Caixa', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    cod_identificacao: { type: DataTypes.STRING, allowNull: false, unique: true },
    descricao: { type: DataTypes.STRING, allowNull: false },
    altura: { type: DataTypes.DECIMAL(10,2), allowNull: false },
    largura: { type: DataTypes.DECIMAL(10,2), allowNull: false },
    profundidade: { type: DataTypes.DECIMAL(10,2), allowNull: false },
    peso: { type: DataTypes.DECIMAL(10,3), allowNull: false },
    id_cliente: { type: DataTypes.INTEGER, references: { model: 'Clientes', key: 'id' } },
  });

  Caixa.associate = (models) => {
    // relação inversa por CÓDIGO
    Caixa.hasMany(models.Produto, {
      foreignKey: 'cod_identificacao',
      sourceKey: 'cod_identificacao',
      as: 'Produtos'
    });
  };

  return Caixa;
}
