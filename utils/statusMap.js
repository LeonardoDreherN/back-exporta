// utils/statusMap.js
const { Op } = require('sequelize');

/**
 * Ajuste estes arrays para refletirem **seus** status reais em BD.
 * Exemplos comuns:
 *  - pagamentos: LIQUIDADO/PAGO, PENDENTE, ESTORNADO, FALHA/RECUSADO
 *  - se já usa inglês no BD, pode manter PAID/PENDING/REFUNDED/FAILED
 */
const MAP = {
    // aliases → lista de status reais aceitos no BD
    PAID: ['LIQUIDADO', 'PAGO', 'PAID'],
    PENDING: ['PENDENTE', 'A_RECEBER', 'PENDING'],
    REFUNDED: ['ESTORNADO', 'REFUNDED'],
    FAILED: ['FALHA', 'RECUSADO', 'FAILED'],

    // grupos semânticos (shortcuts)
    paid_like: ['LIQUIDADO', 'PAGO', 'PAID'],
    open_like: ['PENDENTE', 'A_RECEBER', 'PENDING'],
    error_like: ['FALHA', 'RECUSADO', 'FAILED'],
    refund_like: ['ESTORNADO', 'REFUNDED'],
};

/**
 * Converte entrada (string CSV, grupo, alias, array) → array de status reais.
 * Ex.: "PAID,PENDING" → ['LIQUIDADO','PAGO','PAID','PENDENTE','A_RECEBER','PENDING']
 * Ex.: "paid_like" → ['LIQUIDADO','PAGO','PAID']
 */
function expandStatuses(input) {
    if (!input) return null;

    const pushAll = (acc, list) => {
        for (const s of list) if (s && !acc.includes(s)) acc.push(s);
    };

    const normOne = (s) => String(s).trim();
    const tokens = Array.isArray(input)
        ? input.map(normOne)
        : String(input).split(',').map(normOne);

    const out = [];
    for (const t of tokens) {
        if (!t) continue;
        const key = t.toUpperCase();
        if (MAP[key]) {
            pushAll(out, MAP[key]);
        } else if (MAP[t]) { // permite minúsculo para grupos (paid_like)
            pushAll(out, MAP[t]);
        } else {
            // valor já é um status do seu BD (usa como está)
            if (!out.includes(t)) out.push(t);
        }
    }
    return out.length ? out : null;
}

/**
 * Monta where.status com Op.in a partir do status informado.
 * Retorna { wherePart } para mesclar em um where maior.
 */
function buildStatusWhere(statusParam) {
    const expanded = expandStatuses(statusParam);
    if (!expanded) return {};
    return { status: { [Op.in]: expanded } };
}

module.exports = {
    MAP,
    expandStatuses,
    buildStatusWhere,
};
