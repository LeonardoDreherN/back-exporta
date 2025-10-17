// controllers/cotacoes.controller.js
const { Op, literal } = require('sequelize');
const { Cotacao, sequelize } = require('../models');
const { keepFirstPageFromPdfB64 } = require('../utils/pdfTools');
const { normalizeUpsStatusFromTimeline } = require('../services/ups/tracking')
const tracking = require("../services/ups/tracking");
const { sse } = require('../server');

/**
 * Cria uma cotação idempotente por (cliente_id, pedido_ref)
 * Payload esperado (JSONB em formato livre):
 * {
 *   cliente_id: number,
 *   pedido_ref: string,
 *   pais_remetente?: string, // ISO2
 *   pais_dest?: string,      // ISO2
 *   pedido?: object,         // snapshot livre do step 1
 *   caixa?: object           // snapshot livre do step 3 (pode ser array ou objeto)
 * }
 */

function toInt(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function normRef(v) {
    return String(v || '').trim(); // se quiser: .toUpperCase()
}

function guessLabelFilename(mime = '') {
    if (mime === 'image/png') return 'label.png';
    if (mime === 'image/gif') return 'label.gif';
    if (mime === 'text/plain') return 'label.zpl';
    return 'label.bin';
}

async function downloadEtiqueta(req, res) {
    const id = req.params.id;
    const row = await Cotacao.findByPk(id);
    if (!row || !row.etiqueta_base64) return res.status(404).json({ error: 'Etiqueta não disponível' });

    const mime = row.etiqueta_mime || 'application/octet-stream';
    const buf = Buffer.from(row.etiqueta_base64, 'base64');
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Content-Disposition', `attachment; filename="${guessLabelFilename(mime)}"`);
    return res.send(buf);
}


async function downloadInvoice(req, res) {
    const id = req.params.id;
    const row = await Cotacao.findByPk(id);
    if (!row || !row.invoice_base64) return res.status(404).json({ error: 'Invoice não disponível' });

    const mime = row.invoice_mime || 'application/pdf';
    let b64 = row.invoice_base64;

    // recorta para 1 página só:
    if (mime === 'application/pdf') {
        b64 = await keepFirstPageFromPdfB64(b64);
    }

    const buf = Buffer.from(b64, 'base64');
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Content-Disposition', 'attachment; filename="invoice.pdf"');
    return res.send(buf);
}

async function createCotacaoReal(req, res) {
    const t = await sequelize.transaction();
    try {
        const cliente_id = Number(req.clienteId);
        if (!cliente_id) { await t.rollback(); return res.status(401).json({ ok: false, error: 'Cliente não autenticado' }); }

        const { pedido_ref: pedido_ref_raw, pais_remetente, pais_dest, pedido, caixa, tracking_number, carrier } = req.body || {};
        const pedido_ref = normRef(pedido_ref_raw);
        if (!pedido_ref) { await t.rollback(); return res.status(400).json({ ok: false, error: 'pedido_ref é obrigatório' }); }

        const existente = await Cotacao.findOne({
            where: { cliente_id, pedido_ref },
            attributes: ['id', 'pedido_ref', 'createdAt'],
            transaction: t, lock: t.LOCK.UPDATE,
        });
        if (existente) {
            await t.rollback();
            return res.status(409).json({ ok: false, created: false, cotacao_id: existente.id, pedido_ref: existente.pedido_ref, error: 'Já existe uma cotação para este pedido' });
        }

        const registro = await Cotacao.create({
            cliente_id,
            pedido_ref,
            pais_remetente: pais_remetente ?? null,
            pais_dest: pais_dest ?? null,
            pedido: (pedido && typeof pedido === 'object') ? pedido : {},
            caixa: (caixa && typeof caixa === 'object') ? caixa : {},
            tracking_number: tracking_number ?? null,
            carrier: carrier ?? 'UPS',                 // guarde a transportadora
            status_norm: 'CRIADO',                     // default
            last_tracking_at: null,
        }, { transaction: t });

        await t.commit();
        return res.json({ ok: true, created: true, cotacao_id: registro.id, pedido_ref: registro.pedido_ref });
    } catch (err) {
        await t.rollback();
        if (err?.name === 'SequelizeUniqueConstraintError') {
            try {
                const existente = await Cotacao.findOne({ where: { cliente_id: Number(req.clienteId), pedido_ref: normRef(req.body?.pedido_ref) } });
                if (existente) return res.status(409).json({ ok: false, created: false, cotacao_id: existente.id, pedido_ref: existente.pedido_ref, error: 'Já existe uma cotação para este pedido' });
            } catch (_) { }
        }
        console.error('createCotacaoReal error:', err);
        return res.status(500).json({ ok: false, error: 'Erro ao criar cotação' });
    }
}

async function attachDocs(req, res) {
    try {
        const { id } = req.params;
        const { etiqueta_base64, etiqueta_mime, invoice_base64, invoice_mime, tracking_number, carrier } = req.body || {};
        const cot = await Cotacao.findByPk(id);
        if (!cot) return res.status(404).json({ ok: false, error: 'Cotação não encontrada' });

        const patch = {};
        if (typeof etiqueta_base64 === 'string') patch.etiqueta_base64 = etiqueta_base64;
        if (typeof etiqueta_mime === 'string') patch.etiqueta_mime = etiqueta_mime;
        if (typeof invoice_base64 === 'string') patch.invoice_base64 = invoice_base64;
        if (typeof invoice_mime === 'string') patch.invoice_mime = invoice_mime;
        if (typeof tracking_number === 'string') patch.tracking_number = tracking_number;
        if (typeof carrier === 'string') patch.carrier = carrier;

        if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: 'Nada para atualizar' });

        await cot.update(patch);

        return res.json({
            ok: true,
            cotacao_id: cot.id,
            tracking_number: cot.tracking_number || null,
            has_label: !!cot.etiqueta_base64,
            has_invoice: !!cot.invoice_base64,
        });
    } catch (err) {
        console.error('attachDocs error:', err);
        return res.status(500).json({ ok: false, error: 'Erro ao anexar documentos' });
    }
}

async function getCotacaoStatusByPedidoRef(req, res) {
    try {
        const cliente_id = toInt(req.clienteId);
        if (!cliente_id) return res.status(401).json({ ok: false, error: 'Cliente não autenticado' });

        const pedido_ref = normRef(req.params.pedido_ref);
        if (!pedido_ref) return res.status(400).json({ ok: false, error: 'pedido_ref inválido' });

        const existente = await Cotacao.findOne({
            where: { cliente_id, pedido_ref },
            attributes: ['id', 'pedido_ref', 'createdAt'],
        });

        return res.json({ ok: true, hasActive: !!existente, cotacaoId: existente?.id || null });
    } catch (err) {
        console.error('getCotacaoStatusByPedidoRef error:', err);
        return res.status(500).json({ ok: false, error: 'Erro ao checar status da cotação' });
    }
}

async function getCotacao(req, res) {
    try {
        const cliente_id = toInt(req.clienteId);
        if (!cliente_id) return res.status(401).json({ ok: false, error: 'Cliente não autenticado' });

        const id = toInt(req.params.id);
        if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });

        const cot = await Cotacao.findOne({ where: { id, cliente_id } });
        if (!cot) return res.status(404).json({ ok: false, error: 'Cotação não encontrada' });

        return res.json({ ok: true, data: cot });
    } catch (err) {
        console.error('getCotacao error:', err);
        return res.status(500).json({ ok: false, error: 'Erro ao buscar cotação' });
    }
}

async function listCotacoes(req, res) {
    try {
        const cliente_id = toInt(req.clienteId);
        if (!cliente_id) return res.status(401).json({ ok: false, error: 'Cliente não autenticado' });

        const {
            pedido_ref, tracking_number, date_from, date_to,
            page = 1, limit = 20,
            only_with_tracking, // "1"
            refresh,            // "1" força refresh
        } = req.query;

        const where = { cliente_id };
        if (pedido_ref && String(pedido_ref).trim()) {
            where.pedido_ref = { [Op.iLike]: `%${String(pedido_ref).trim()}%` };
        }
        if (tracking_number && String(tracking_number).trim()) {
            where.tracking_number = { [Op.iLike]: `%${String(tracking_number).trim()}%` };
        }
        if (only_with_tracking === '1') where.tracking_number = { [Op.ne]: null };

        if (date_from || date_to) {
            where.created_at = {};
            if (date_from) where.created_at[Op.gte] = new Date(`${date_from}T00:00:00.000Z`);
            if (date_to) where.created_at[Op.lte] = new Date(`${date_to}T23:59:59.999Z`);
        }

        const pageNum = Math.max(1, Number(page) || 1);
        const lim = Math.min(100, Math.max(1, Number(limit) || 20));
        const offset = (pageNum - 1) * lim;

        const { rows, count } = await Cotacao.findAndCountAll({
            where,
            attributes: {
                exclude: ['etiqueta_base64', 'invoice_base64'],
                include: [
                    [literal(`COALESCE("etiqueta_base64",'') <> ''`), 'has_label'],
                    [literal(`COALESCE("invoice_base64",'') <> ''`), 'has_invoice'],
                    // ⬇️ garanta que o front receba:
                    'status_norm',
                    'last_tracking_at',
                ],
            },
            order: [['created_at', 'DESC']],
            limit: lim,
            offset,
        });

        // ---------- auto refresh de status ----------
        const now = Date.now();
        const forceRefresh = String(refresh) === '1';
        const REFRESH_COOLDOWN_MIN = 5;

        const itens = await Promise.all(rows.map(async (r) => {
            const plain = r.get({ plain: true });
            const statusNorm = plain.status_norm || 'CRIADO';
            const tn = plain.tracking_number;

            // só atualiza quem tem tracking e não está finalizado
            if (!tn || statusNorm === 'ENTREGUE') return plain;

            const lastAt = plain.last_tracking_at ? new Date(plain.last_tracking_at).getTime() : 0;
            const elapsedMin = (now - lastAt) / 60000;
            if (!forceRefresh && lastAt && elapsedMin < REFRESH_COOLDOWN_MIN) return plain;

            try {
                const carrier = plain.carrier || 'UPS';
                const timeline = await tracking.getTimeline(carrier, tn); // ← implemente no seu serviço
                if (!Array.isArray(timeline) || timeline.length === 0) return plain;

                const novo = normalizeUpsStatusFromTimeline(timeline);
                const newestEvt = timeline[0]; // assuma que vem ordenado do mais novo pro mais antigo
                const eventTime = new Date(newestEvt.eventTime || newestEvt.activityDateTime || now);

                const isNewer = !plain.last_tracking_at || eventTime > new Date(plain.last_tracking_at);
                const changed = statusNorm !== novo;

                if ((isNewer || changed) && novo) {
                    await r.update({
                        status_norm: novo,
                        last_tracking_at: eventTime,
                        tracking_raw: newestEvt, // ou guarde a timeline inteira, se preferir
                    });
                    plain.status_norm = novo;
                    plain.last_tracking_at = eventTime;
                    sse.broadcastStatusUpdate({ cotacao_id: r.id, status_norm: novo });
                }
            } catch (e) {
                console.error('tracking refresh failed for', r.id, e?.message || e);
            }
            return plain;
        }));
        // -------------------------------------------

        return res.json({ ok: true, cliente_id, page: pageNum, limit: lim, offset, total: count, itens });
    } catch (err) {
        console.error('listRemessas error:', err);
        return res.status(500).json({ ok: false, error: 'Erro ao listar remessas' });
    }
}

async function updateCotacao(req, res) {
    try {
        const { id } = req.params;
        const body = req.body || {};
        const cot = await Cotacao.findByPk(id);
        if (!cot) return res.status(404).json({ ok: false, error: 'Cotação não encontrada' });
        await cot.update(body);
        return res.json({ ok: true, data: cot });
    } catch (err) {
        console.error('updateCotacao error:', err);
        return res.status(500).json({ ok: false, error: 'Erro ao atualizar cotação' });
    }
}

async function deleteCotacao(req, res) {
    try {
        const { id } = req.params;
        const cot = await Cotacao.findByPk(id);
        if (!cot) return res.status(404).json({ ok: false, error: 'Cotação não encontrada' });
        await cot.destroy();
        return res.json({ ok: true, deleted: true });
    } catch (err) {
        console.error('deleteCotacao error:', err);
        return res.status(500).json({ ok: false, error: 'Erro ao excluir cotação' });
    }
}

module.exports = {
    createCotacaoReal,
    attachDocs,
    getCotacao,
    listCotacoes,
    updateCotacao,
    deleteCotacao,
    downloadEtiqueta,
    downloadInvoice,
    keepFirstPageFromPdfB64,
    getCotacaoStatusByPedidoRef
};
