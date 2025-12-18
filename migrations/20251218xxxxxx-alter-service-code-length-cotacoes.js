'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        // Aumenta o tamanho do campo service_code
        await queryInterface.changeColumn('cotacoes', 'service_code', {
            type: Sequelize.STRING(64), // 64 é seguro p/ UPS + FedEx + outros
            allowNull: true,
        });
    },

    async down(queryInterface, Sequelize) {
        // Volta para 2 caracteres (cuidado: se já tiver dados maiores, vai falhar/truncar)
        await queryInterface.changeColumn('cotacoes', 'service_code', {
            type: Sequelize.STRING(2),
            allowNull: true,
        });
    },
};
