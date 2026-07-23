const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AdminUser = sequelize.define('AdminUser', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    role: {
      type: DataTypes.ENUM('admin', 'developer', 'support', 'operations'),
      allowNull: false,
      defaultValue: 'operations',
    },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    lastLoginAt: { type: DataTypes.DATE, allowNull: true },
  });

  return AdminUser;
};
