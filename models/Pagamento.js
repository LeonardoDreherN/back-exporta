// models/Pagamento.js
// Cada cobrança criada no Asaas por PIX ou cartão: recarga da carteira agora,
// pagamento direto de envio depois. É o espelho local do status no Asaas.
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Pagamento = sequelize.define('Pagamento', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        cliente_id: { type: DataTypes.INTEGER, allowNull: false },

        // recarga | cotacao
        finalidade: { type: DataTypes.STRING(16), allowNull: false },
        cotacao_id: { type: DataTypes.INTEGER, allowNull: true },

        // PIX | CREDIT_CARD
        metodo: { type: DataTypes.STRING(16), allowNull: false },

        // valor que vira saldo/paga o envio; a taxa do cartão é do cliente e
        // fica separada para não ser creditada junto.
        valor_centavos: { type: DataTypes.INTEGER, allowNull: false },
        taxa_centavos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        total_centavos: { type: DataTypes.INTEGER, allowNull: false },

        asaas_payment_id: { type: DataTypes.STRING(64), allowNull: true, unique: true },
        invoice_url: { type: DataTypes.STRING(255), allowNull: true },
        pix_copia_cola: { type: DataTypes.TEXT, allowNull: true },
        pix_expira_em: { type: DataTypes.DATE, allowNull: true },

        // PENDING até o Asaas confirmar; PAGO depois; ESTORNADO / FALHOU / CANCELADO.
        status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'PENDING' },
        status_asaas: { type: DataTypes.STRING(32), allowNull: true },
        pago_em: { type: DataTypes.DATE, allowNull: true },
    }, {
        tableName: 'pagamentos',
        underscored: true,
        indexes: [{ fields: ['cliente_id'] }, { fields: ['cotacao_id'] }],
    });

    return Pagamento;
};
