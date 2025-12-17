'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        // 1) adiciona coluna (em gramas)
        await queryInterface.addColumn('Caixas', 'peso', {
            type: Sequelize.DECIMAL(10, 3),
            allowNull: false,
            defaultValue: 0.500, // 500g
        });

        // 2) garante que registros antigos fiquem com 500g (extra defensivo)
        await queryInterface.sequelize.query(`
            UPDATE "Caixas"
            SET "peso" = 0.500
            WHERE "peso" IS NULL;
        `);
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('Caixas', 'peso');
    }
};
