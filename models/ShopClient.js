// models/ShopClient.js
const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const ShopClient = sequelize.define(
    "ShopClient",
    {
      shop: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
        unique: true,
      },
      clienteId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      tableName: "ShopClients",
      timestamps: true,
    }
  );

  return ShopClient;
};
