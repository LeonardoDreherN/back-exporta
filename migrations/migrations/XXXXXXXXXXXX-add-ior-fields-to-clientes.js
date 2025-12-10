'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await Promise.all([
            queryInterface.addColumn('Clientes', 'descIOR', {
                type: Sequelize.STRING,
                allowNull: true,
            }),
            queryInterface.addColumn('Clientes', 'nomeIOR', {
                type: Sequelize.STRING,
                allowNull: true,
            }),
            queryInterface.addColumn('Clientes', 'emailIOR', {
                type: Sequelize.STRING,
                allowNull: true,
            }),
            queryInterface.addColumn('Clientes', 'tipoIOR', {
                type: Sequelize.STRING,
                allowNull: true,
            }),
            queryInterface.addColumn('Clientes', 'paisIOR', {
                type: Sequelize.STRING,
                allowNull: true,
            }),
            queryInterface.addColumn('Clientes', 'cod_postalIOR', {
                type: Sequelize.STRING,
                allowNull: true,
            }),
            queryInterface.addColumn('Clientes', 'estadoIOR', {
                type: Sequelize.STRING,
                allowNull: true,
            }),
            queryInterface.addColumn('Clientes', 'cidadeIOR', {
                type: Sequelize.STRING,
                allowNull: true,
            }),
            queryInterface.addColumn('Clientes', 'enderecoIOR', {
                type: Sequelize.STRING,
                allowNull: true,
            }),
            queryInterface.addColumn('Clientes', 'numeroIOR', {
                type: Sequelize.STRING,
                allowNull: true,
            }),
            queryInterface.addColumn('Clientes', 'telefoneIOR', {
                type: Sequelize.STRING,
                allowNull: true,
            }),
            queryInterface.addColumn('Clientes', 'state_tax_idIOR', {
                type: Sequelize.STRING,
                allowNull: true,
            }),
        ]);
    },

    async down(queryInterface, Sequelize) {
        await Promise.all([
            queryInterface.removeColumn('Clientes', 'descIOR'),
            queryInterface.removeColumn('Clientes', 'nomeIOR'),
            queryInterface.removeColumn('Clientes', 'emailIOR'),
            queryInterface.removeColumn('Clientes', 'tipoIOR'),
            queryInterface.removeColumn('Clientes', 'paisIOR'),
            queryInterface.removeColumn('Clientes', 'cod_postalIOR'),
            queryInterface.removeColumn('Clientes', 'estadoIOR'),
            queryInterface.removeColumn('Clientes', 'cidadeIOR'),
            queryInterface.removeColumn('Clientes', 'enderecoIOR'),
            queryInterface.removeColumn('Clientes', 'numeroIOR'),
            queryInterface.removeColumn('Clientes', 'telefoneIOR'),
            queryInterface.removeColumn('Clientes', 'state_tax_idIOR'),
        ]);
    },
};
