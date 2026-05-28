const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const WorldeaseMaster = sequelize.define('WorldeaseMaster', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        cliente_id: { type: DataTypes.INTEGER, allowNull: false },

        // GCCN — preenchido após o CloseOut
        gccn: { type: DataTypes.STRING(11), allowNull: true },

        shipper_account_number: { type: DataTypes.STRING(20), allowNull: false },

        // IDs das cotações incluídas neste master
        cotacao_ids: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },

        status: {
            type: DataTypes.ENUM('ABERTO', 'FECHADO', 'CANCELADO'),
            allowNull: false,
            defaultValue: 'ABERTO',
        },

        // Label master retornada pelo CloseOut
        label_base64: { type: DataTypes.TEXT, allowNull: true },
        label_mime: { type: DataTypes.STRING(32), allowNull: true, defaultValue: 'image/png' },
        label_path: { type: DataTypes.STRING, allowNull: true },

        closeout_at: { type: DataTypes.DATE, allowNull: true },
        raw_response: { type: DataTypes.JSONB, allowNull: true },
    }, {
        tableName: 'worldease_masters',
        underscored: true,
        timestamps: true,
        indexes: [
            { fields: ['cliente_id', 'created_at'] },
            { fields: ['gccn'] },
        ],
    });

    return WorldeaseMaster;
};
