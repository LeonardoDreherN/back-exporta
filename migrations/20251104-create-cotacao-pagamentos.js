// migrations/20251104-create-cotacao-pagamentos.js
'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('cotacao_pagamentos', {
            id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
            cliente_id: { type: Sequelize.BIGINT, allowNull: false },
            cotacao_id: { type: Sequelize.BIGINT, allowNull: false },
            pedido_ref: { type: Sequelize.STRING, allowNull: true },

            currency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: 'USD' },
            amount_base: { type: Sequelize.DECIMAL(14, 2), allowNull: true },
            amount_service_options: { type: Sequelize.DECIMAL(14, 2), allowNull: true },
            amount_itemized: { type: Sequelize.DECIMAL(14, 2), allowNull: true },
            amount_discount: { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 },
            amount_fees_gateway: { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 },
            amount_total: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
            amount_paid: { type: Sequelize.DECIMAL(14, 2), allowNull: true },

            status: {
                type: Sequelize.ENUM('PENDING', 'PAID', 'REFUNDED', 'FAILED'),
                allowNull: false,
                defaultValue: 'PENDING'
            },
            method: {
                type: Sequelize.ENUM('PIX', 'CARD', 'INVOICE', 'WIRE', 'OTHER'),
                allowNull: true
            },
            external_tx_id: { type: Sequelize.STRING, allowNull: true },
            notes: { type: Sequelize.TEXT, allowNull: true },

            paid_at: { type: Sequelize.DATE, allowNull: true },
            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
        });

        await queryInterface.addIndex('cotacao_pagamentos', ['cliente_id']);
        await queryInterface.addIndex('cotacao_pagamentos', ['cotacao_id']);
        await queryInterface.addIndex('cotacao_pagamentos', ['status']);
        await queryInterface.addIndex('cotacao_pagamentos', ['paid_at']);
    },

    async down(queryInterface) {
        await queryInterface.removeIndex('cotacao_pagamentos', ['cliente_id']);
        await queryInterface.removeIndex('cotacao_pagamentos', ['cotacao_id']);
        await queryInterface.removeIndex('cotacao_pagamentos', ['status']);
        await queryInterface.removeIndex('cotacao_pagamentos', ['paid_at']);
        await queryInterface.dropTable('cotacao_pagamentos');
    }
};
