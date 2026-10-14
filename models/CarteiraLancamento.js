// models/CarteiraLancamento.js
// Livro de lançamentos da carteira Intrex. Cada crédito ou débito é uma linha
// nova e nenhuma linha é editada ou apagada: o saldo é sempre a soma. Um campo
// `saldo` mutável perderia o porquê de cada centavo e quebraria em corrida
// (dois débitos lendo o mesmo saldo).
//
// Valores em centavos de real, inteiro com sinal: positivo entra, negativo sai.
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const CarteiraLancamento = sequelize.define('CarteiraLancamento', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        cliente_id: { type: DataTypes.INTEGER, allowNull: false },

        // recarga | debito_envio | estorno | ajuste
        tipo: { type: DataTypes.STRING(24), allowNull: false },
        valor_centavos: { type: DataTypes.INTEGER, allowNull: false },
        descricao: { type: DataTypes.STRING(160), allowNull: true },

        // De onde veio o lançamento (pagamento Asaas, cotação, ajuste manual).
        referencia_tipo: { type: DataTypes.STRING(24), allowNull: true },
        referencia_id: { type: DataTypes.INTEGER, allowNull: true },

        // Chave única do fato que gerou o lançamento (ex.: "recarga:pagamento:12").
        // O webhook do Asaas reenvia eventos; sem ela a mesma recarga entraria
        // duas vezes no saldo.
        chave: { type: DataTypes.STRING(80), allowNull: false, unique: true },
    }, {
        tableName: 'carteira_lancamentos',
        underscored: true,
        updatedAt: false,
        indexes: [{ fields: ['cliente_id'] }],
    });

    return CarteiraLancamento;
};
