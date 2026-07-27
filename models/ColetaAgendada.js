// models/ColetaAgendada.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const ColetaAgendada = sequelize.define('ColetaAgendada', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        cliente_id: { type: DataTypes.INTEGER, allowNull: false },

        carrier: { type: DataTypes.STRING(16), allowNull: false },

        pickup_date: { type: DataTypes.DATEONLY, allowNull: true },
        ready_time: { type: DataTypes.STRING(5), allowNull: true },
        close_time: { type: DataTypes.STRING(5), allowNull: true },

        rua: { type: DataTypes.STRING, allowNull: true },
        numero: { type: DataTypes.STRING, allowNull: true },
        complemento: { type: DataTypes.STRING, allowNull: true },
        cidade: { type: DataTypes.STRING, allowNull: true },
        estado: { type: DataTypes.STRING, allowNull: true },
        cep: { type: DataTypes.STRING, allowNull: true },
        pais: { type: DataTypes.STRING, allowNull: true },

        contact_name: { type: DataTypes.STRING, allowNull: true },
        phone: { type: DataTypes.STRING, allowNull: true },

        confirmation_number: { type: DataTypes.STRING, allowNull: true },
        status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'AGENDADA' },

        raw_response: { type: DataTypes.JSONB, allowNull: true },
    }, {
        tableName: 'coletas_agendadas',
        underscored: true,
        timestamps: true,
        indexes: [
            { fields: ['cliente_id', 'pickup_date'] },
        ],
    });

    ColetaAgendada.associate = (models) => {
        if (models.Cliente) {
            ColetaAgendada.belongsTo(models.Cliente, { foreignKey: 'cliente_id', as: 'cliente', constraints: false });
        }
    };

    return ColetaAgendada;
};
