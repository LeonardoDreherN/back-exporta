const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ChangelogEntry = sequelize.define('ChangelogEntry', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    version: { type: DataTypes.STRING, allowNull: false },
    releaseDate: { type: DataTypes.DATEONLY, allowNull: false },
    changes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    published: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdBy: { type: DataTypes.INTEGER, allowNull: true },
  });

  ChangelogEntry.associate = (models) => {
    if (models.AdminUser) {
      ChangelogEntry.belongsTo(models.AdminUser, { foreignKey: 'createdBy', as: 'createdByUser', constraints: false });
    }
  };

  return ChangelogEntry;
};
