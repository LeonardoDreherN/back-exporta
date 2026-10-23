// models/ChamadoMensagem.js
//
// Linha do tempo do chamado: o que o cliente escreveu, o que a Intrex
// respondeu e o que a transportadora reportou.
//
// A mensagem da transportadora entra como autor TRANSPORTADORA e é gerada a
// partir do evento de rastreio, não digitada por ninguém — é o texto cru que a
// FedEx/UPS devolveu, preservado como veio para o suporte poder conferir.
const { DataTypes } = require('sequelize');

const AUTORES = ['CLIENTE', 'INTREX', 'TRANSPORTADORA'];

module.exports = (sequelize) => {
    const ChamadoMensagem = sequelize.define(
        'ChamadoMensagem',
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            chamado_id: { type: DataTypes.INTEGER, allowNull: false },

            autor: { type: DataTypes.ENUM(...AUTORES), allowNull: false },
            texto: { type: DataTypes.TEXT, allowNull: true },

            /**
             * Anexo no Supabase Storage (bucket `anexos`), o mesmo caminho que
             * etiqueta e invoice usam. Disco local não serve: no Render o
             * sistema de arquivos é efêmero e o arquivo sumiria no próximo
             * deploy, justamente o documento que a alfândega está esperando.
             */
            anexo_path: { type: DataTypes.STRING, allowNull: true },
            anexo_nome: { type: DataTypes.STRING, allowNull: true },
            anexo_mime: { type: DataTypes.STRING, allowNull: true },

            /**
             * Chave de idempotência das mensagens geradas do rastreio: sem
             * ela, cada sincronização repetiria o mesmo evento da
             * transportadora na thread.
             */
            chave: { type: DataTypes.STRING, allowNull: true, unique: true },
        },
        {
            tableName: 'chamado_mensagens',
            underscored: true,
            timestamps: true,
            indexes: [{ fields: ['chamado_id'] }],
        },
    );

    ChamadoMensagem.associate = (models) => {
        if (models.Chamado) {
            ChamadoMensagem.belongsTo(models.Chamado, {
                foreignKey: 'chamado_id',
                as: 'chamado',
                constraints: false,
            });
        }
    };

    ChamadoMensagem.AUTORES = AUTORES;

    return ChamadoMensagem;
};
