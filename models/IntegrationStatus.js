const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const IntegrationStatus = sequelize.define('IntegrationStatus', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    key: { type: DataTypes.STRING, allowNull: false, unique: true },
    label: { type: DataTypes.STRING, allowNull: false },
    state: {
      type: DataTypes.ENUM('operational', 'maintenance', 'instability'),
      allowNull: false,
      defaultValue: 'operational',
    },
    message: { type: DataTypes.TEXT, allowNull: true },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true },
  });

  IntegrationStatus.associate = (models) => {
    if (models.AdminUser) {
      IntegrationStatus.belongsTo(models.AdminUser, { foreignKey: 'updatedBy', as: 'updatedByUser', constraints: false });
    }
  };

  return IntegrationStatus;
};
