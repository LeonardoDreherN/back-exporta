const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const RoadmapCard = sequelize.define('RoadmapCard', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    column: {
      type: DataTypes.ENUM('planejado', 'em_desenvolvimento', 'em_testes', 'publicado'),
      allowNull: false,
      defaultValue: 'planejado',
    },
    position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    createdBy: { type: DataTypes.INTEGER, allowNull: true },
  });

  RoadmapCard.associate = (models) => {
    if (models.AdminUser) {
      RoadmapCard.belongsTo(models.AdminUser, { foreignKey: 'createdBy', as: 'createdByUser', constraints: false });
    }
  };

  return RoadmapCard;
};
