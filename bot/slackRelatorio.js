require('dotenv').config();
const cron = require('node-cron');
const axios = require('axios');
const { format, subDays } = require('date-fns');
const { Sequelize } = require('sequelize');
const models = require('../models');
const Cotacao = require('../models/Cotacao');

const HOOK = process.env.SLACK_WEBHOOK_URL;
const TZ = process.env.TZ || 'America/Sao_Paulo';

// gera texto do relatório
function asMoney(n) { return (Number(n || 0)).toFixed(2); }

async function queryRelatorio({ cliente_id, from, to, status = 'PAID', currency = null }) {
    const where = { cliente_id, status };
    if (currency) where.currency = currency;

    where.paid_at = {};
    if (from) where.paid_at[Sequelize.Op.gte] = new Date(`${from}T00:00:00`);
    if (to) where.paid_at[Sequelize.Op.lte] = new Date(`${to}T23:59:59`);

    const rows = await Cotacao.findAll({
        where,
        attributes: [
            [Sequelize.fn('DATE', Sequelize.fn('timezone', TZ, Sequelize.col('paid_at'))), 'dia'],
            'currency',
            [Sequelize.fn('COUNT', Sequelize.col('id')), 'qtd'],
            [Sequelize.fn('SUM', Sequelize.col('amount_total')), 'bruto'],
            [Sequelize.fn('SUM', Sequelize.col('amount_fees_gateway')), 'fees'],
            [Sequelize.fn('SUM', Sequelize.col('amount_discount')), 'desc'],
            [Sequelize.fn('SUM', Sequelize.col('amount_paid')), 'pago'],
        ],
        group: [Sequelize.literal(`DATE(timezone('${TZ}', paid_at))`), 'currency'],
        order: [[Sequelize.literal(`DATE(timezone('${TZ}', paid_at))`), 'ASC']],
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
    const header = `*📊 Relatório de Pagamentos*\nPeríodo: *${from} → ${to}*\nStatus: *${status}*${currency ? ` | Moeda: *${currency}*` : ''}`;
    if (!rows.length) return `${header}\n\nSem registros no período.`;

    const lines = rows.map(r => {
        const dia = r.get('dia');
        const cur = r.get('currency');
        return `• ${dia} (${cur}) — Qtd: ${r.get('qtd')} | Bruto: ${asMoney(r.get('bruto'))} | Fees: ${asMoney(r.get('fees'))} | Desc: ${asMoney(r.get('desc'))} | Pago: ${asMoney(r.get('pago'))}`;
    }).join('\n');

    const totalsText = Object.entries(totals).map(([cur, t]) =>
        `= ${cur} ⇒ Qtd: ${t.qtd} | Bruto: ${asMoney(t.bruto)} | Fees: ${asMoney(t.fees)} | Desc: ${asMoney(t.desc)} | Pago: ${asMoney(t.pago)}`
    ).join('\n');

    return `${header}\n\n${lines}\n\n*Totais*\n${totalsText}`;
}

// cron diário 08:00
cron.schedule('0 8 * * *', async () => {
    try {
        const cliente_id = 1; // ajuste para seu tenant/cliente
        const now = new Date();
        const to = format(now, 'yyyy-MM-dd');
        const from = format(subDays(now, 1), 'yyyy-MM-dd');

        const { rows, totals } = await queryRelatorio({ cliente_id, from, to, status: 'PAID', currency: null });
        const text = formatSlack({ rows, totals, from, to, status: 'PAID', currency: null });

        await axios.post(HOOK, { text });
        console.log('[SlackRelatorio] enviado');
    } catch (e) {
        console.error('[SlackRelatorio] erro', e);
    }
});

// (opcional) execução manual: node bot/slackRelatorio.js once
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
