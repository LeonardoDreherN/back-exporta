const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const StatusIncident = sequelize.define(
    'StatusIncident',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      integrationKey: { type: DataTypes.STRING, allowNull: false },
      previousState: { type: DataTypes.STRING, allowNull: true },
      newState: { type: DataTypes.STRING, allowNull: false },
      message: { type: DataTypes.TEXT, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      updatedAt: false,
      indexes: [{ fields: ['integrationKey', 'createdAt'] }],
    }
  );

  StatusIncident.associate = (models) => {
    if (models.AdminUser) {
      StatusIncident.belongsTo(models.AdminUser, { foreignKey: 'createdBy', as: 'createdByUser', constraints: false });
    }
  };

  return StatusIncident;
};
