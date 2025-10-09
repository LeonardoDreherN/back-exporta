// migrations/XXXX-create-shipments.js
'use strict';

module.exports = {
    async up(qi, Sequelize) {
        await qi.createTable('shipments', {
            id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
            user_id: { type: Sequelize.BIGINT, allowNull: false },
            shop_id: { type: Sequelize.BIGINT, allowNull: true },

            rate_result: { type: Sequelize.JSONB, allowNull: true },  // Step 1 (Rate)
            ship_result: { type: Sequelize.JSONB, allowNull: true },  // Step 2 (Ship)
            track_result: { type: Sequelize.JSONB, allowNull: true },  // Step 3 (Track)

            carrier: { type: Sequelize.STRING(20), allowNull: true },  // opcional (ex.: 'UPS')
            status: { type: Sequelize.STRING(40), allowNull: true },  // opcional (ex.: 'created')

            created_at: { type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
            updated_at: { type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') }
        });

        await qi.addIndex('shipments', ['user_id', 'created_at']);
    },

    async down(qi) {
        await qi.dropTable('shipments');
    }
};
