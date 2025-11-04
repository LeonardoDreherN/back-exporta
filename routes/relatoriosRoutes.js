// routes/relatoriosRoutes.js
const router = require('express').Router();
const db = require('../models');
const { Op } = require('sequelize');
const { buildStatusWhere } = require('../utils/statusMap');

// Tenta detectar um model de pagamentos no seu projeto
function getPagamentoModel() {
    const cands = [
        'CotacaoPagamento', // principal
        'Pagamento',
        'Pagamentos',
        'Payment',
        'Payments',
        'Transacao',
        'Transactions',
    ];
    for (const k of cands) {
        if (db[k]) return db[k];
    }
    return null;
}

// Normaliza datas (from/to como YYYY-MM-DD) para faixa [00:00:00, 23:59:59] em UTC
function normalizeDateRange(fromStr, toStr) {
    let from = null, to = null;
    if (fromStr) {
        const d = new Date(fromStr + 'T00:00:00Z');
        if (!isNaN(d)) from = d;
    }
    if (toStr) {
        const d = new Date(toStr + 'T23:59:59Z');
        if (!isNaN(d)) to = d;
    }
    return { from, to };
}

// Converte array de objetos em CSV simples (separador ;)
function toCSV(rows, columns) {
    const head = columns.map(c => c.header).join(';');
    const lines = [head];

    for (const r of rows) {
        const line = columns.map(c => {
            let v = r[c.key];
            if (v === null || v === undefined) v = '';
            if (v instanceof Date) v = v.toISOString();
            const s = String(v).replace(/\r?\n/g, ' ').replace(/;/g, ',');
            return s;
        }).join(';');
        lines.push(line);
    }
    return lines.join('\n');
}

// GET /api/relatorios/pagamentos.csv
router.get('/pagamentos.csv', async (req, res) => {
    try {
        const { from: fromStr, to: toStr, status, currency, by } = req.query || {};
        const clienteId = req.clienteId || req.usuario?.clienteId || req.user?.clienteId || null;

        // Filtro base
        const where = {};

        // cliente
        if (clienteId) where.cliente_id = clienteId;

        // status (aliases/grupos/CSV – vide utils/statusMap.js)
        Object.assign(where, buildStatusWhere(status));

        // currency
        if (currency && String(currency).trim()) {
            where.currency = String(currency).toUpperCase();
        }

        // datas dinâmicas
        const { from, to } = normalizeDateRange(fromStr, toStr);
        const dateField = (by === 'created') ? 'createdAt' : 'paid_at';
        if (from || to) {
            const range = {};
            if (from) range[Op.gte] = from;
            if (to) range[Op.lte] = to;
            where[dateField] = range;
        }

        const Pagamento = getPagamentoModel();

        let rows = [];
        if (Pagamento) {
            rows = await Pagamento.findAll({
                where,
                order: [[dateField, 'DESC']],
                attributes: [
                    'id',
                    'pedido_ref',
                    'currency',
                    'status',
                    'paid_at',
                    'createdAt',
                    // valores reais:
                    [db.Sequelize.col('amount_paid'), 'amount_paid'],
                    [db.Sequelize.col('amount_total'), 'amount_total'],
                    [db.Sequelize.col('amount_fees_gateway'), 'amount_fees_gateway'],
                    [db.Sequelize.col('amount_discount'), 'amount_discount'],
                ],
                raw: true,
            });
        } else {
            rows = [];
        }

        // Normaliza campos para o CSV
        const mapped = rows.map(r => {
            const paid = (r.amount_paid != null) ? Number(r.amount_paid) : NaN;
            const total = (r.amount_total != null) ? Number(r.amount_total) : NaN;
            const valorNum = Number.isFinite(paid) ? paid : (Number.isFinite(total) ? total : null);

            return {
                id: r.id ?? '',
                pedido_ref: r.pedido_ref ?? r.pedidoId ?? r.order_ref ?? '',
                valor: (valorNum != null && Number.isFinite(valorNum)) ? valorNum.toFixed(2) : '',
                currency: r.currency ?? r.moeda ?? '',
                status: r.status ?? '',
                paid_at: r.paid_at ?? r.paidAt ?? null,
                created_at: r.createdAt ?? r.criado_em ?? null,
                // (se quiser adicionar colunas extras no CSV, basta adicionar no 'columns' abaixo)
                // fees: r.amount_fees_gateway ?? '',
                // discount: r.amount_discount ?? '',
            };
        });

        const columns = [
            { header: 'id', key: 'id' },
            { header: 'pedido_ref', key: 'pedido_ref' },
            { header: 'valor', key: 'valor' },       // amount_paid (fallback amount_total)
            { header: 'currency', key: 'currency' },
            { header: 'status', key: 'status' },
            { header: 'paid_at', key: 'paid_at' },
            { header: 'created_at', key: 'created_at' },
            // { header: 'fees',      key: 'fees' },
            // { header: 'discount',  key: 'discount' },
        ];

        const csv = toCSV(mapped, columns);

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="pagamentos.csv"');
        return res.status(200).send(csv);
    } catch (e) {
        console.error('[relatorios/pagamentos.csv] erro:', e);
        return res.status(500).json({ ok: false, error: 'Falha ao gerar relatório' });
    }
});

module.exports = router;
