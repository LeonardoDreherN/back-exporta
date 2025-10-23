// controllers/cotacoes.controller.js
const { Op, literal } = require('sequelize');
const { Cotacao, Cliente, sequelize } = require('../models');
const { keepFirstPageFromPdfB64 } = require('../utils/pdfTools');
const { normalizeUpsStatusFromTimeline } = require('../services/ups/tracking');
const tracking = require('../services/ups/tracking');
const { aplicarPlano } = require('../utils/regrasPlanos');
const { cotarCarrier } = require('../services/carriers');
const { sse } = require('../server'); // usa a mesma instância criada no app.js

function toInt(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function normRef(v) {
    return String(v || '').trim();
}
function guessLabelFilename(mime = '') {
    if (mime === 'image/png') return 'label.png';
    if (mime === 'image/gif') return 'label.gif';
    if (mime === 'text/plain') return 'label.zpl';
    return 'label.bin';
}

function toNumSafe(v) {
    if (v == null) return undefined;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
}

function extractPrecoFromUpsRaw(raw) {
    if (!raw) return undefined;
    const rated = Array.isArray(raw?.RateResponse?.RatedShipment)
        ? raw.RateResponse.RatedShipment[0]
        : raw?.RateResponse?.RatedShipment;

    if (!rated) return undefined;

    // Prioriza negociado
    const neg = rated?.NegotiatedRates?.NetSummaryCharges?.GrandTotal?.MonetaryValue;
    const tot = rated?.TotalCharges?.MonetaryValue;
    return toNumSafe(neg ?? tot);
}

function inferFonteBase(carrierResp, overrideUsado) {
    if (overrideUsado) return 'override';
    if (carrierResp?.raw?.RateResponse?.RatedShipment?.NegotiatedRates
        || (Array.isArray(carrierResp?.raw?.RateResponse?.RatedShipment)
            && carrierResp.raw.RateResponse.RatedShipment.some(r => r?.NegotiatedRates))) {
        return 'negotiated';
    }
    if (carrierResp?.published != null) return 'published';
    if (carrierResp?.amount != null) return 'amount';
    return 'total';
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
        // autenticacao/cliente
        const cliente_id = Number(req.cliente?.id ?? req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId);
        if (!cliente_id) { await t.rollback(); return res.status(401).json({ ok: false, error: 'Cliente não autenticado' }); }

        const {
            pedido_ref: pedido_ref_raw,
            pais_remetente, pais_dest,
            pedido, caixa, tracking_number, carrier,
            rate_payload,          // opcional: payload completo da UPS
            preco_base,            // opcional: override do front
            freightValueNum        // opcional: compat com front
        } = req.body || {};

        const pedido_ref = normRef(pedido_ref_raw);
        if (!pedido_ref) { await t.rollback(); return res.status(400).json({ ok: false, error: 'pedido_ref é obrigatório' }); }

        // idempotência por pedido_ref
        const existente = await Cotacao.findOne({
            where: { cliente_id, pedido_ref },
            attributes: ['id', 'pedido_ref', 'createdAt'],
            transaction: t, lock: t.LOCK.UPDATE,
        });
        if (existente) {
            await t.rollback();
            return res.status(409).json({
                ok: false, created: false,
                cotacao_id: existente.id,
                pedido_ref: existente.pedido_ref,
                error: 'Já existe uma cotação para este pedido'
            });
        }

        // ======== Determinar precoBase ========
        let precoBase = null;
        let carrierResp = null;

        // A) Front mandou o valor já calculado (aceita "42,55")
        const precoBaseOverride = toNumSafe(preco_base ?? freightValueNum);
        const overrideUsado = Number.isFinite(precoBaseOverride);

        if (overrideUsado) {
            precoBase = precoBaseOverride;
        } else if (rate_payload) {
            // B) Sem override: usar payload para cotar
            try {
                carrierResp = await cotarCarrier({ payload: rate_payload });

                // tenta campos do adaptador
                precoBase =
                    toNumSafe(carrierResp?.precoBase) ??
                    toNumSafe(carrierResp?.negotiated) ??
                    toNumSafe(carrierResp?.published) ??
                    toNumSafe(carrierResp?.amount);

                // fallback para RAW da UPS
                if (!Number.isFinite(precoBase)) {
                    const raw = carrierResp?.raw || carrierResp;
                    precoBase = extractPrecoFromUpsRaw(raw);
                }
            } catch (e) {
                await t.rollback();
                const status = e?.response?.status || 502;
                const upstream = e?.upstream || e?.response?.data;
                const msg = upstream?.message || upstream?.error_description || upstream?.error || e.message || 'Falha ao cotar com o carrier';
                return res.status(status).json({ ok: false, error: msg, upstream });
            }
        } else {
            // C) Nem override, nem payload
            await t.rollback();
            return res.status(400).json({
                ok: false,
                error: 'Envie preco_base (ou freightValueNum) OU rate_payload para cotação.'
            });
        }

        if (!Number.isFinite(precoBase)) {
            await t.rollback();
            return res.status(400).json({ ok: false, error: 'Carrier não retornou preço' });
        }

        // ===== Plano do cliente e cálculo
        const cli = await Cliente.findByPk(cliente_id, { attributes: ['id', 'plano', 'emailPrincipal', 'codigo'], transaction: t });
        const plano = cli?.plano || (console.log('[COTACAO] cliente sem plano definido, usando básico'), 'basico');

        // console.log('[COTACAO] plano do cliente =', plano, 'precoBase =', precoBase);

        // aplicarPlano deve receber (precoBase, plano) — ajuste se sua assinatura for diferente
        const pricing = aplicarPlano(precoBase, plano);

        // fonte da base (auditoria)
        const fonte_base = inferFonteBase(carrierResp, overrideUsado);

        // guarda pedido com pricing (mantém objeto original + pricing)
        const pedidoJson = (pedido && typeof pedido === 'object') ? { ...pedido } : {};
        pedidoJson.pricing = {
            plano_aplicado: pricing.plano_aplicado,
            preco_base: pricing.preco_base,
            preco_final: pricing.preco_final,
            ajuste: pricing.ajuste,
            carrier: carrier ?? 'UPS',
            fonte_base,
            carrier_raw: carrierResp || null,
        };

        // persistência
        console.log('[COTACAO][PLANO]', {
            cliente_id,
            cliente_debug: { id: cli?.id, email: cli?.emailPrincipal, codigo: cli?.codigo, plano: cli?.plano },
            preco_base: pricing.preco_base,
            preco_final: pricing.preco_final,
            ajuste: pricing.ajuste
        });

        const registro = await Cotacao.create({
            cliente_id,
            pedido_ref,
            debug: {
                cliente_id,
                plano_reportado: plano,
                preco_base_usado: pricing.preco_base
            },
            plano_aplicado: pricing.plano_aplicado,
            preco_base: pricing.preco_base,
            preco_final: pricing.preco_final,
            pais_remetente: pais_remetente ?? null,
            pais_dest: pais_dest ?? null,
            pedido: pedidoJson,
            caixa: (caixa && typeof caixa === 'object') ? caixa : {},
            tracking_number: tracking_number ?? null,
            carrier: carrier ?? 'UPS',
            status_norm: 'CRIADO',
            last_tracking_at: null,
        }, { transaction: t });

        await t.commit();
        return res.json({
            ok: true,
            created: true,
            cotacao_id: registro.id,
            pedido_ref: registro.pedido_ref,
            // opcional expor valores já calculados:
            preco_final: pricing.preco_final,
            plano_aplicado: pricing.plano_aplicado
        });
    } catch (err) {
        try { await t.rollback(); } catch (_) { }
        console.error('[COTACAO][ERROR]', err?.message, err?.stack);
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
            only_with_tracking,
            refresh,
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
            where.createdAt = {};
            if (date_from) where.createdAt[Op.gte] = new Date(`${date_from}T00:00:00.000Z`);
            if (date_to) where.createdAt[Op.lte] = new Date(`${date_to}T23:59:59.999Z`);
        }

        const pageNum = Math.max(1, Number(page) || 1);
        const lim = Math.min(100, Math.max(1, Number(limit) || 20));
        const offset = (pageNum - 1) * lim;

        const { rows, count } = await Cotacao.findAndCountAll({
            where,
            attributes: {
                exclude: ['etiqueta_base64', 'invoice_base64'],
                include: [
                    [literal(`COALESCE(etiqueta_base64, '') <> ''`), 'has_label'],
                    [literal(`COALESCE(invoice_base64, '') <> ''`), 'has_invoice'],
                    'status_norm',
                    'last_tracking_at',
                ],
            },
            order: [['createdAt', 'DESC']],
            limit: lim,
            offset,
        });

        // refresh leve de tracking
        const now = Date.now();
        const forceRefresh = String(refresh) === '1';
        const REFRESH_COOLDOWN_MIN = 5;

        const itens = await Promise.all(rows.map(async (r) => {
            const plain = r.get({ plain: true });
            const statusNorm = plain.status_norm || 'CRIADO';
            const tn = plain.tracking_number;

            // ❌ Sem tracking -> não tenta normalizar.
            if (!tn) return plain;

            // Evita refresh agressivo em cotações recém-criadas
            const createdAtMs = new Date(plain.createdAt).getTime();
            const nowMs = Date.now();
            const ageMin = (nowMs - createdAtMs) / 60000;

            const lastAt = plain.last_tracking_at ? new Date(plain.last_tracking_at).getTime() : 0;
            const elapsedMin = (nowMs - lastAt) / 60000;

            const forceRefresh = String(refresh) === '1';
            const REFRESH_COOLDOWN_MIN = 5;

            // 🔒 Quarentena de 30min para cotação “CRIADO” sem tracking visto ainda (evita falso trânsito)
            if (!forceRefresh && statusNorm === 'CRIADO' && !lastAt && ageMin < 30) {
                return plain; // mantém CRIADO
            }

            if (!forceRefresh && lastAt && elapsedMin < REFRESH_COOLDOWN_MIN) {
                return plain; // respeita cooldown
            }

            try {
                const carrier = plain.carrier || 'UPS';
                const timeline = await tracking.getTimeline(carrier, tn);
                if (!Array.isArray(timeline) || timeline.length === 0) return plain;

                // ✅ Mais conservador: só troca para EM_TRANSITO se houver scan físico OU status I
                const newestEvt = timeline[0];
                const txt = [newestEvt.statusDescription, newestEvt.description, newestEvt.activity]
                    .filter(Boolean).join(' ').toUpperCase();
                const code = String(newestEvt.statusCode || '').toUpperCase();

                const physicalScanHints = [
                    'ORIGIN SCAN',
                    'DEPARTURE SCAN',
                    'ARRIVAL SCAN',
                    'OUT FOR DELIVERY',
                    'IMPORT SCAN',
                    'EXPORT SCAN'
                ];

                let novo = normalizeUpsStatusFromTimeline(timeline);

                if (novo === 'EM_TRANSITO') {
                    const hasPhysical = code === 'I' || physicalScanHints.some(k => txt.includes(k));
                    if (!hasPhysical) {
                        // Mantém CRIADO enquanto só houver “billing info received/label created”
                        novo = 'CRIADO';
                    }
                }

                const eventTime = new Date(newestEvt.eventTime || newestEvt.activityDateTime || nowMs);
                const isNewer = !plain.last_tracking_at || eventTime > new Date(plain.last_tracking_at);
                const changed = statusNorm !== novo;

                if ((isNewer || changed) && novo) {
                    await r.update({
                        status_norm: novo,
                        last_tracking_at: eventTime,
                        tracking_raw: newestEvt,
                    });
                    plain.status_norm = novo;
                    plain.last_tracking_at = eventTime;

                    if (sse?.broadcastStatusUpdate) {
                        sse.broadcastStatusUpdate({ cotacao_id: r.id, status_norm: novo });
                    }
                }
            } catch (e) {
                console.error('tracking refresh failed for', r.id, e?.message || e);
            }

            return plain;
        }));

        return res.json({ ok: true, cliente_id, page: pageNum, limit: lim, offset, total: count, itens });
    } catch (err) {
        console.error('listCotacoes error:', err);
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
