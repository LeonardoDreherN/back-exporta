// models/AsaasPayment.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const AsaasBoleto = sequelize.define('AsaasBoleto', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

        // vínculo com seu sistema
        clienteId: { type: DataTypes.INTEGER, allowNull: false },
        
        // dados do Asaas
        asaasCustomerId: { type: DataTypes.STRING, allowNull: true },
        asaasPaymentId: { type: DataTypes.STRING, allowNull: false, unique: true },
        bankSlipUrl: { type: DataTypes.STRING, allowNull: true },

        value: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
        dueDate: { type: DataTypes.DATEONLY, allowNull: true },
        status: { type: DataTypes.STRING, allowNull: true }, // PENDING, RECEIVED, etc.

    });

    return AsaasBoleto;
};
