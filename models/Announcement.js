const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Announcement = sequelize.define(
    'Announcement',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      title: { type: DataTypes.STRING, allowNull: false },
      body: { type: DataTypes.TEXT, allowNull: false },
      category: {
        type: DataTypes.ENUM('atualizacao', 'manutencao', 'incidente', 'novidade'),
        allowNull: false,
      },
      audience: {
        type: DataTypes.ENUM('todos', 'cliente_especifico', 'shopify', 'nuvemshop'),
        allowNull: false,
        defaultValue: 'todos',
      },
      clienteId: { type: DataTypes.INTEGER, allowNull: true },
      showBanner: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      showOnStatusPage: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      publishedAt: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      indexes: [
        { fields: ['active'] },
        { fields: ['audience'] },
        { fields: ['clienteId'] },
      ],
    }
  );

  Announcement.associate = (models) => {
    if (models.Cliente) {
      Announcement.belongsTo(models.Cliente, { foreignKey: 'clienteId', as: 'cliente', constraints: false });
    }
    if (models.AdminUser) {
      Announcement.belongsTo(models.AdminUser, { foreignKey: 'createdBy', as: 'createdByUser', constraints: false });
    }
  };

  return Announcement;
};
