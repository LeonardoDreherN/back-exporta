const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AdminAuditLog = sequelize.define(
    'AdminAuditLog',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      adminUserId: { type: DataTypes.INTEGER, allowNull: true },
      action: { type: DataTypes.STRING, allowNull: false },
      entityType: { type: DataTypes.STRING, allowNull: true },
      entityId: { type: DataTypes.STRING, allowNull: true },
      clienteId: { type: DataTypes.INTEGER, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: true, defaultValue: {} },
      ipAddress: { type: DataTypes.STRING, allowNull: true },
    },
    {
      updatedAt: false,
      indexes: [
        { fields: ['adminUserId'] },
        { fields: ['clienteId'] },
        { fields: ['action'] },
        { fields: ['createdAt'] },
      ],
    }
  );

  AdminAuditLog.associate = (models) => {
    if (models.AdminUser) {
      AdminAuditLog.belongsTo(models.AdminUser, { foreignKey: 'adminUserId', as: 'adminUser', constraints: false });
    }
    if (models.Cliente) {
      AdminAuditLog.belongsTo(models.Cliente, { foreignKey: 'clienteId', as: 'cliente', constraints: false });
    }
  };

  return AdminAuditLog;
};
