// models/LeadSimulador.js
// Contato deixado no simulador de frete da página Sobre.
//
// POR QUE EXISTE: o formulário público pede e-mail e WhatsApp para liberar o
// preço, e o front sempre mandou os dois no corpo de /api/public-quote — mas o
// controller só lia medidas e destino. O contato chegava e era descartado: a
// pessoa se identificava para ver a cotação e ninguém na Intrex ficava sabendo.
//
// Uma linha por simulação, não por pessoa. Quem simula três vezes mudando o
// peso gera três linhas, e isso é informação: mostra o que a pessoa estava
// tentando enviar antes de desistir ou chamar no WhatsApp. O agrupamento por
// e-mail é feito na tela do admin.
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const LeadSimulador = sequelize.define('LeadSimulador', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

        email: { type: DataTypes.STRING(160), allowNull: true },
        // Só dígitos, como o front manda (DDD + número).
        telefone: { type: DataTypes.STRING(20), allowNull: true },

        // De onde veio o formulário ('site-sobre-hero'). Serve para separar o
        // simulador da landing de qualquer outro ponto de captura futuro.
        origem: { type: DataTypes.STRING(60), allowNull: true },

        // O que a pessoa estava tentando cotar.
        destino: { type: DataTypes.STRING(2), allowNull: true },
        peso_kg: { type: DataTypes.DECIMAL(8, 3), allowNull: true },
        comprimento_cm: { type: DataTypes.INTEGER, allowNull: true },
        largura_cm: { type: DataTypes.INTEGER, allowNull: true },
        altura_cm: { type: DataTypes.INTEGER, allowNull: true },

        // Resultado da cotação que a pessoa viu. `cotou: false` é o caso mais
        // interessante para o comercial: deixou o contato e NÃO viu preço.
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
