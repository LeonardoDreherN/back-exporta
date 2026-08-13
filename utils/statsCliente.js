// utils/statsCliente.js
// Números de uso da Intrex (cotações/entregas) por cliente — genérico, não depende de
// plataforma (Nuvemshop/Shopify), então fica compartilhado em vez de em um controller só.
const { Op } = require('sequelize');
const db = require('../models');

const ENTREGUE_STATUSES = ['ENTREGUE'];
const EM_ANDAMENTO_STATUSES = ['EM_TRANSITO', 'SAIU_PARA_ENTREGA', 'COLETADO'];

async function buildStatsPorCliente(clienteId) {
    const [totalCotacoes, entregues, emAndamento] = await Promise.all([
        db.Cotacao.count({ where: { cliente_id: clienteId } }),
        db.Cotacao.count({ where: { cliente_id: clienteId, status_norm: { [Op.in]: ENTREGUE_STATUSES } } }),
        db.Cotacao.count({ where: { cliente_id: clienteId, status_norm: { [Op.in]: EM_ANDAMENTO_STATUSES } } }),
    ]);
    return { totalCotacoes, entregues, emAndamento };
}

module.exports = { buildStatsPorCliente };
