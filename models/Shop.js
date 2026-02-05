const { DataTypes } = require("sequelize");

// models/Shop.js
module.exports = (sequelize) => {
  const Shop = sequelize.define("Shop", {
    shop: { type: DataTypes.STRING, primaryKey: true, unique: true }, // ex: intexteste.myshopify.com
    accessToken: { type: DataTypes.TEXT, allowNull: false },
    scope: { type: DataTypes.TEXT },

    // ✅ vínculo com seu cliente no Intrex
    clienteId: { type: DataTypes.INTEGER, allowNull: false },
  });

  return Shop;
};
