const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SyncLog = sequelize.define(
    'SyncLog',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      integration: {
        type: DataTypes.ENUM('shopify', 'nuvemshop', 'ups', 'fedex', 'database', 'api'),
        allowNull: false,
      },
      clienteId: { type: DataTypes.INTEGER, allowNull: true },
      status: {
        type: DataTypes.ENUM('ok', 'error'),
        allowNull: false,
        defaultValue: 'ok',
      },
      message: { type: DataTypes.TEXT, allowNull: true },
      durationMs: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      updatedAt: false,
      indexes: [
        { fields: ['integration', 'createdAt'] },
        { fields: ['clienteId'] },
        { fields: ['status'] },
      ],
    }
  );

  SyncLog.associate = (models) => {
    if (models.Cliente) {
      SyncLog.belongsTo(models.Cliente, { foreignKey: 'clienteId', as: 'cliente', constraints: false });
    }
  };

  return SyncLog;
};
