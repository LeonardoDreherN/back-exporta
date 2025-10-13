// controllers/cotacoes.controller.js
const { Op, literal } = require('sequelize');
const { Cotacao, sequelize } = require('../models');
const { keepFirstPageFromPdfB64 } = require('../utils/pdfTools');

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
        const cliente_id = Number(req.clienteId)
        if (!cliente_id) {
            await t.rollback();
            return res.status(401).json({ ok: false, error: 'Cliente não autenticado' });
        }
        const {
            pedido_ref: pedido_ref_raw,
            pais_remetente,
            pais_dest,
            pedido,
            caixa,
            tracking_number,
        } = req.body || {};

        const pedido_ref = normRef(pedido_ref_raw);
        if (!pedido_ref) {
            await t.rollback();
            return res.status(400).json({ ok: false, error: 'pedido_ref é obrigatório' });
        }

        const existente = await Cotacao.findOne({
            where: { cliente_id, pedido_ref },
            attributes: ['id', 'pedido_ref', 'createdAt'],
            transaction: t,
            lock: t.LOCK.UPDATE, // evita corrida em concorrência alta
        });

        if (existente) {
            await t.rollback();
            return res.status(409).json({
                ok: false,
                created: false,
                cotacao_id: existente.id,
                pedido_ref: existente.pedido_ref,
                error: 'Já existe uma cotação para este pedido',
            });
        }

        // findOrCreate garante idempotência pelo índice único (cliente_id, pedido_ref)
        const registro = await Cotacao.create({
            cliente_id,
            pedido_ref,
            pais_remetente: pais_remetente ?? null,
            pais_dest: pais_dest ?? null,
            pedido: (pedido && typeof pedido === 'object') ? pedido : {},
            caixa: (caixa && typeof caixa === 'object') ? caixa : {},
            tracking_number: tracking_number ?? null,
        }, { transaction: t });

        await t.commit();
        return res.json({
            ok: true,
            created: true,
            cotacao_id: registro.id,
            pedido_ref: registro.pedido_ref,
        });
    } catch (err) {
        await t.rollback();
        // Se for corrida e estourar UNIQUE, devolve o existente
        if (err?.name === 'SequelizeUniqueConstraintError') {
            try {
                const existente = await Cotacao.findOne({
                    where: { cliente_id: Number(req.clienteId), pedido_ref: normRef(req.body?.pedido_ref) },
                });
                if (existente) {
                    return res.status(409).json({
                        ok: false,
                        created: false,
                        cotacao_id: existente.id,
                        pedido_ref: existente.pedido_ref,
                        error: 'Já existe uma cotação para este pedido',
                    });
                }
            } catch (_) { }
        }
        console.error('createCotacaoReal error:', err);
        return res.status(500).json({ ok: false, error: 'Erro ao criar cotação' });
    }
}

/**
 * Anexa/atualiza documentos e tracking
 * Body aceita combinação de:
 * {
 *   etiqueta_base64?: string,
 *   etiqueta_mime?:   string,   // 'application/pdf' | 'image/png' ...
 *   invoice_base64?:  string,
 *   invoice_mime?:    string,   // 'application/pdf'
 *   tracking_number?: string
 * }
 */
async function attachDocs(req, res) {
    try {
        const { id } = req.params;
        const {
            etiqueta_base64,
            etiqueta_mime,
            invoice_base64,
            invoice_mime,
            tracking_number,
        } = req.body || {};

        const cot = await Cotacao.findByPk(id);
        if (!cot) return res.status(404).json({ ok: false, error: 'Cotação não encontrada' });

        const patch = {};
        if (typeof etiqueta_base64 === 'string') patch.etiqueta_base64 = etiqueta_base64;
        if (typeof etiqueta_mime === 'string') patch.etiqueta_mime = etiqueta_mime;

        if (typeof invoice_base64 === 'string') patch.invoice_base64 = invoice_base64;
        if (typeof invoice_mime === 'string') patch.invoice_mime = invoice_mime;

        if (typeof tracking_number === 'string') patch.tracking_number = tracking_number;

        if (!Object.keys(patch).length) {
            return res.status(400).json({ ok: false, error: 'Nada para atualizar' });
        }

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

/**
 * GET /cotacoes/:id
 */

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

        return res.json({
            ok: true,
            hasActive: !!existente,
            cotacaoId: existente?.id || null,
        });
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

/**
 * GET /cotacoes
 * Query params suportados:
 *  - cliente_id: number
 *  - pedido_ref: string (like)
 *  - tracking_number: string (like)
 *  - date_from / date_to: 'YYYY-MM-DD'
 *  - page (1-based), limit
 */

async function listCotacoes(req, res) {
    try {
        const cliente_id = toInt(req.clienteId);
        if (!cliente_id) return res.status(401).json({ ok: false, error: 'Cliente não autenticado' });

        const {
            pedido_ref,
            tracking_number,
            date_from,
            date_to,
            page = 1,
            limit = 20,
            only_with_tracking, // "1" para listar só quem tem tracking
        } = req.query;

        const where = { cliente_id };

        if (pedido_ref && String(pedido_ref).trim()) {
            where.pedido_ref = { [Op.iLike]: `%${String(pedido_ref).trim()}%` };
        }
        if (tracking_number && String(tracking_number).trim()) {
            where.tracking_number = { [Op.iLike]: `%${String(tracking_number).trim()}%` };
        }
        if (only_with_tracking === '1') {
            where.tracking_number = { [Op.ne]: null };
        }

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
                ],
            },
            order: [['created_at', 'DESC']],
            limit: lim,
            offset,
        });

        const itens = rows.map(r => r.get({ plain: true }));

        return res.json({
            ok: true,
            cliente_id,
            page: pageNum,
            limit: lim,
            offset,
            total: count,
            itens,
        });
    } catch (err) {
        console.error('listRemessas error:', err);
        return res.status(500).json({ ok: false, error: 'Erro ao listar remessas' });
    }
}

/**
 * PATCH /cotacoes/:id
 * Atualiza campos simples e/ou JSONB (sem impor formato)
 */
async function updateCotacao(req, res) {
    try {
        const { id } = req.params;
        const body = req.body || {};
        const cot = await Cotacao.findByPk(id);
        if (!cot) return res.status(404).json({ ok: false, error: 'Cotação não encontrada' });

        // Protege chaves únicas caso não queira permitir troca:
        // delete body.pedido_ref; delete body.cliente_id;

        await cot.update(body);
        return res.json({ ok: true, data: cot });
    } catch (err) {
        console.error('updateCotacao error:', err);
        return res.status(500).json({ ok: false, error: 'Erro ao atualizar cotação' });
    }
}

/**
 * DELETE /cotacoes/:id
 */
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
