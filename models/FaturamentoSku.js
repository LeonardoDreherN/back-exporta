// models/FaturamentoSku.js
// Valor de faturamento de um SKU, por cliente.
//
// O preco que o comprador paga na loja e o valor que vai na invoice comercial
// nao sao o mesmo numero quando a operacao usa triangulacao: o lojista vende
// ao IOR (importador de registro) pelo valor de custo, e e esse valor que a
// alfandega ve. Uma bolsa de USD 145 na vitrine pode ser faturada a USD 40.
//
// Ate aqui esse valor so existia na cabeca do cliente, aplicado a mao na hora
// de emitir a invoice. Guardar por SKU permite calcular o imposto sobre a
// base certa — a mesma que vai ser declarada — em vez de sobre o preco de
// vitrine, que superestima e assusta o comprador no checkout.
//
// IMPORTANTE: este valor tem que corresponder a uma venda real ao IOR. Ele
// nao e um parametro para "baixar o imposto": e o preco da transacao que a
// invoice declara. Quem assina a invoice responde pelo numero.
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const FaturamentoSku = sequelize.define('FaturamentoSku', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

        cliente_id: { type: DataTypes.INTEGER, allowNull: false },

        // SKU como a plataforma manda (Shopify: items[].sku). Normalizado
        // para maiusculas sem espaco nas pontas antes de gravar e de buscar,
        // porque a mesma loja escreve "bolsa-01" e "BOLSA-01".
        sku: { type: DataTypes.STRING(120), allowNull: false },

        // Descricao so para o admin reconhecer a linha. Nao vai na invoice.
        descricao: { type: DataTypes.STRING(200), allowNull: true },

        // O valor faturado, em USD, por UNIDADE.
        valor_faturado_usd: { type: DataTypes.DECIMAL(12, 2), allowNull: false },

        ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    }, {
        tableName: 'faturamento_skus',
        underscored: true,
        timestamps: true,
        indexes: [
            // Um valor por SKU por cliente. O upsert do admin depende disto.
            { unique: true, fields: ['cliente_id', 'sku'] },
        ],
    });

    return FaturamentoSku;
};
