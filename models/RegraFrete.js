const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const RegraFrete = sequelize.define('RegraFrete', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        id_cliente: { type: DataTypes.INTEGER, allowNull: false },
        nome: { type: DataTypes.STRING, allowNull: false },
        ativa: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        valorMinimo: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        // array de strings, ex.: ["UPS"], ["FEDEX"], ["UPS","FEDEX"]
        transportadoras: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
        tipoDesconto: {
            type: DataTypes.ENUM('gratis', 'percentual', 'fixo'),
            allowNull: false,
            defaultValue: 'gratis',
        },
        // percentual (0-100) ou valor fixo abatido; ignorado quando tipoDesconto = 'gratis'
        valorDesconto: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
        // menor = avaliada primeiro quando mais de uma regra bate pra mesma transportadora
        prioridade: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    }, {
        tableName: 'regras_frete',
        timestamps: true,
    });

    return RegraFrete;
};
