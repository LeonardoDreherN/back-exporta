// models/LeadSimulador.js
// Contato deixado no simulador de frete da página Sobre.
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const LeadSimulador = sequelize.define('LeadSimulador', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

        // Adicionado para salvar o nome preenchido no modal
        nome: { type: DataTypes.STRING(120), allowNull: true },

        email: { type: DataTypes.STRING(160), allowNull: true },
        // Só dígitos, como o front manda (DDD + número).
        telefone: { type: DataTypes.STRING(20), allowNull: true },

        // De onde veio o formulário ('site-sobre-hero').
        origem: { type: DataTypes.STRING(60), allowNull: true },

        // O que a pessoa estava tentando cotar.
        destino: { type: DataTypes.STRING(2), allowNull: true },
        peso_kg: { type: DataTypes.DECIMAL(8, 3), allowNull: true },
        comprimento_cm: { type: DataTypes.INTEGER, allowNull: true },
        largura_cm: { type: DataTypes.INTEGER, allowNull: true },
        altura_cm: { type: DataTypes.INTEGER, allowNull: true },

        // Resultado da cotação que a pessoa viu.
        cotou: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        melhor_carrier: { type: DataTypes.STRING(20), allowNull: true },
        melhor_preco_usd: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    }, {
        tableName: 'leads_simulador',
        underscored: true,
        timestamps: true,
        indexes: [
            { fields: ['email'] },
            { fields: ['created_at'] },
        ],
    });

    return LeadSimulador;
};