require('dotenv').config();
const cron = require('node-cron');
const axios = require('axios');
const { format, subDays } = require('date-fns');
const { Sequelize } = require('sequelize');
const db = require('../models'); // { CotacaoPagamento, ... }
const { buildStatusWhere, expandStatuses } = require('../utils/statusMap');

const HOOK = process.env.SLACK_WEBHOOK_URL;
const TZ = process.env.TZ || 'America/Sao_Paulo';

function asMoney(n) { return (Number(n || 0)).toFixed(2); }

async function queryRelatorio({ cliente_id, from, to, status = 'PAID', currency = null, by }) {
    const where = { cliente_id };
    Object.assign(where, buildStatusWhere(status));
    if (currency) where.currency = currency;

    const dateField = (by === 'created') ? 'createdAt' : 'paid_at';
    if (from || to) {
        where[dateField] = {};
        if (from) where[dateField][Sequelize.Op.gte] = new Date(`${from}T00:00:00Z`);
        if (to) where[dateField][Sequelize.Op.lte] = new Date(`${to}T23:59:59Z`);
    }

    // expressão de dia com timezone para atributo e group
    const dayExpr = db.Sequelize.fn(
        'DATE',
        db.Sequelize.fn('timezone', TZ, db.Sequelize.col(dateField))
    );

    const rows = await db.CotacaoPagamento.findAll({
        where,
        attributes: [
            [dayExpr, 'dia'],
            'currency',
            [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'qtd'],
            [db.Sequelize.fn('SUM', db.Sequelize.col('amount_total')), 'bruto'],
            [db.Sequelize.fn('SUM', db.Sequelize.col('amount_fees_gateway')), 'fees'],
            [db.Sequelize.fn('SUM', db.Sequelize.col('amount_discount')), 'desc'],
            [db.Sequelize.fn('SUM', db.Sequelize.col('amount_paid')), 'pago'],
        ],
        group: [dayExpr, 'currency'],
        order: [[dayExpr, 'ASC']],
    });

    const totals = rows.reduce((acc, r) => {
        const cur = r.get('currency');
        acc[cur] = acc[cur] || { qtd: 0, bruto: 0, fees: 0, desc: 0, pago: 0 };
        acc[cur].qtd += Number(r.get('qtd') || 0);
        acc[cur].bruto += Number(r.get('bruto') || 0);
        acc[cur].fees += Number(r.get('fees') || 0);
        acc[cur].desc += Number(r.get('desc') || 0);
        acc[cur].pago += Number(r.get('pago') || 0);
        return acc;
    }, {});

    return { rows, totals };
}

function formatSlack({ rows, totals, from, to, status, currency }) {
    const expanded = expandStatuses(status);
    const statusTxt = expanded && expanded.length ? expanded.join(', ') : String(status || '—');
    const header = `*📊 Relatório de Pagamentos*\nPeríodo: *${from} → ${to}*\nStatus: *${statusTxt}*${currency ? ` | Moeda: *${currency}*` : ''}`;
    if (!rows.length) return `${header}\n\nSem registros no período.`;

    const lines = rows.map(r =>
        `• ${r.get('dia')} (${r.get('currency')}) — Qtd: ${r.get('qtd')} | Bruto: ${asMoney(r.get('bruto'))} | Fees: ${asMoney(r.get('fees'))} | Desc: ${asMoney(r.get('desc'))} | Pago: ${asMoney(r.get('pago'))}`
    ).join('\n');

    const totalsText = Object.entries(totals).map(([cur, t]) =>
        `= ${cur} ⇒ Qtd: ${t.qtd} | Bruto: ${asMoney(t.bruto)} | Fees: ${asMoney(t.fees)} | Desc: ${asMoney(t.desc)} | Pago: ${asMoney(t.pago)}`
    ).join('\n');

    return `${header}\n\n${lines}\n\n*Totais*\n${totalsText}`;
}

// CRON diário 08:00 (São Paulo)
cron.schedule('0 8 * * *', async () => {
    try {
        const cliente_id = 1;
        const now = new Date();
        const to = format(now, 'yyyy-MM-dd');
        const from = format(subDays(now, 1), 'yyyy-MM-dd');

        const { rows, totals } = await queryRelatorio({ cliente_id, from, to, status: 'PAID' });
        const text = formatSlack({ rows, totals, from, to, status: 'PAID' });

        await axios.post(HOOK, { text });
        console.log('[SlackRelatorio] enviado');
    } catch (e) {
        console.error('[SlackRelatorio] erro', e);
    }
});

// Execução manual (7 dias) -> node bot/slackRelatorio.js once
if (process.argv.includes('once')) {
    (async () => {
        const cliente_id = 1;
        const now = new Date();
        const to = format(now, 'yyyy-MM-dd');
        const from = format(subDays(now, 7), 'yyyy-MM-dd');

        const { rows, totals } = await queryRelatorio({ cliente_id, from, to, status: 'PAID' });
        const text = formatSlack({ rows, totals, from, to, status: 'PAID' });

        await axios.post(HOOK, { text });
        process.exit(0);
    })();
}
