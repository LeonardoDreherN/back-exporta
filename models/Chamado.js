// models/Chamado.js
//
// Ocorrência de um envio virando chamado: o que aconteceu, o que o cliente
// precisa fazer e em que pé está.
//
// Antes a tela de Ocorrências só listava cotações com status_norm = EXCECAO e
// mostrava o texto cru da transportadora, em inglês ("Shipment held by
// customs: commercial invoice signature required"). Não havia onde responder,
// anexar o documento pedido nem registrar que o problema foi resolvido — tudo
// acontecia no WhatsApp, fora do sistema.
const { DataTypes } = require('sequelize');

/** Estados possíveis. A tela separa "abertas" (os dois primeiros) de "resolvidas". */
const STATUS = ['ACAO_CLIENTE', 'EM_ANALISE', 'RESOLVIDO'];

/** Classificação da ocorrência, usada para o título e o texto de orientação. */
const TIPOS = ['ALFANDEGA', 'ENDERECO', 'ATRASO', 'TENTATIVA_ENTREGA', 'AVARIA', 'OUTRO'];

module.exports = (sequelize) => {
    const Chamado = sequelize.define(
        'Chamado',
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            cliente_id: { type: DataTypes.INTEGER, allowNull: false },

            /**
             * Envio relacionado. Único quando preenchido: a sincronização com
             * as cotações em EXCECAO roda a cada listagem e o índice é o que
             * impede criar um chamado novo para a mesma cotação toda vez.
             * Fica nulo quando o cliente relata um problema por conta própria.
             */
            cotacao_id: { type: DataTypes.INTEGER, allowNull: true, unique: true },

            tipo: { type: DataTypes.ENUM(...TIPOS), allowNull: false, defaultValue: 'OUTRO' },
            titulo: { type: DataTypes.STRING, allowNull: false },

            /** "O que aconteceu", em português, para o cliente. */
            descricao: { type: DataTypes.TEXT, allowNull: true },
            /** "O que você precisa fazer". Nulo quando a bola está com a Intrex. */
            acao: { type: DataTypes.TEXT, allowNull: true },

            status: {
                type: DataTypes.ENUM(...STATUS),
                allowNull: false,
                defaultValue: 'ACAO_CLIENTE',
            },

            /** Até quando o cliente precisa responder. Nulo quando não há prazo. */
            prazo: { type: DataTypes.DATEONLY, allowNull: true },

            /** AUTO = veio de uma exceção da transportadora; CLIENTE = relatado na tela. */
            origem: {
                type: DataTypes.ENUM('AUTO', 'CLIENTE'),
                allowNull: false,
                defaultValue: 'AUTO',
            },

            resolvido_em: { type: DataTypes.DATE, allowNull: true },
        },
        {
            tableName: 'chamados',
            underscored: true,
            timestamps: true,
            indexes: [{ fields: ['cliente_id', 'status'] }],
        },
    );

    Chamado.associate = (models) => {
        if (models.ChamadoMensagem) {
            Chamado.hasMany(models.ChamadoMensagem, {
                foreignKey: 'chamado_id',
                as: 'mensagens',
                constraints: false,
            });
        }
        if (models.Cotacao) {
            Chamado.belongsTo(models.Cotacao, {
                foreignKey: 'cotacao_id',
                as: 'cotacao',
                constraints: false,
            });
        }
    };

    Chamado.STATUS = STATUS;
    Chamado.TIPOS = TIPOS;

    return Chamado;
};
