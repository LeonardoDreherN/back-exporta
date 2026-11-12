const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const InfoShopify = sequelize.define('InfoShopify', {

        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        shopDomain: { type: DataTypes.STRING, allowNull: false, unique: true },
        id_cliente: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'Clientes', key: 'id' },
        },
        apiVersion: { type: DataTypes.STRING, allowNull: false, defaultValue: '2025-07' }, // nova coluna

        // Prefixo do pedido_ref desta loja (ex.: 'MOMI' => MOMI-1007).
        // NULL = ref crua, como sempre foi. Obrigatorio so quando o mesmo
        // cliente tem mais de uma loja: a Shopify numera por loja, as duas
        // chegam ao 1007 e o UNIQUE (cliente_id, pedido_ref) descarta o
        // segundo.
        prefixoPedido: { type: DataTypes.STRING(8), allowNull: true, defaultValue: null },
    });

    return InfoShopify;
};
