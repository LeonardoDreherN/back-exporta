// controllers/cotacoes.controller.js
const { Op } = require('sequelize');
const { Cotacao, sequelize } = require('../models');

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
async function createCotacaoReal(req, res) {
    const t = await sequelize.transaction();
    try {
        const cliente_id = req.clienteId
        const {
            pedido_ref,
            pais_remetente,
            pais_dest,
            pedido,
            caixa,
        } = req.body || {};

        if (!cliente_id || !pedido_ref) {
            await t.rollback();
            return res.status(400).json({ ok: false, error: 'cliente_id e pedido_ref são obrigatórios' });
        }

        // findOrCreate garante idempotência pelo índice único (cliente_id, pedido_ref)
        const [registro, created] = await Cotacao.findOrCreate({
            where: { cliente_id, pedido_ref },
            defaults: {
                cliente_id,
                pedido_ref,
                pais_remetente: pais_remetente ?? null,
                pais_dest: pais_dest ?? null,
                pedido: typeof pedido === 'object' && pedido !== null ? pedido : {},
                caixa: typeof caixa === 'object' && caixa !== null ? caixa : {},
            },
            transaction: t,
        });

        // Se já existia e vieram dados novos, opcionalmente atualiza
        if (!created) {
            const patch = {};
            if (typeof pais_remetente === 'string') patch.pais_remetente = pais_remetente;
            if (typeof pais_dest === 'string') patch.pais_dest = pais_dest;
            if (pedido && typeof pedido === 'object') patch.pedido = pedido;
            if (caixa && typeof caixa === 'object') patch.caixa = caixa;

            if (Object.keys(patch).length) {
                await registro.update(patch, { transaction: t });
            }
        }

        await t.commit();
        return res.json({
            ok: true,
            created,
            cotacao_id: registro.id,
            pedido_ref: registro.pedido_ref,
        });
    } catch (err) {
        await t.rollback();
        // Se for corrida e estourar UNIQUE, devolve o existente
        if (err?.name === 'SequelizeUniqueConstraintError') {
            try {
                const existente = await Cotacao.findOne({
                    where: { cliente_id: req.body?.cliente_id, pedido_ref: req.body?.pedido_ref },
                });
                if (existente) {
                    return res.json({
                        ok: true,
                        created: false,
                        cotacao_id: existente.id,
                        pedido_ref: existente.pedido_ref,
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
async function getCotacao(req, res) {
    try {
        const { id } = req.params;
        const cot = await Cotacao.findByPk(id);
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
        const {
            cliente_id,
            pedido_ref,
            tracking_number,
            date_from,
            date_to,
            page = 1,
            limit = 20,
        } = req.query;

        const where = {};
        if (cliente_id) where.cliente_id = Number(cliente_id);
        if (pedido_ref) where.pedido_ref = { [Op.iLike]: `%${String(pedido_ref).trim()}%` };
        if (tracking_number) where.tracking_number = { [Op.iLike]: `%${String(tracking_number).trim()}%` };

        // filtro por data de criação (created_at)
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
            order: [['created_at', 'DESC']],
            limit: lim,
            offset,
        });

        return res.json({
            ok: true,
            page: pageNum,
            limit: lim,
            total: count,
            data: rows,
        });
    } catch (err) {
        console.error('listCotacoes error:', err);
        return res.status(500).json({ ok: false, error: 'Erro ao listar cotações' });
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
};
