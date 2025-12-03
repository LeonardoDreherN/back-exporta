// controllers/cotacoes.controller.js
const { Op, literal, Transaction } = require('sequelize');
const { Cotacao, Cliente, sequelize } = require('../models');
const { keepFirstPageFromPdfB64 } = require('../utils/pdfTools');
const { normalizeUpsStatusFromTimeline } = require('../services/ups/tracking');
const tracking = require('../services/ups/tracking');
const { aplicarPlano } = require('../utils/regrasPlanos');
const { cotarCarrier } = require('../services/carriers');
const { sse } = require('../server'); // usa a mesma instância criada no app.js
const { extractUpsBreakdown, extractFromRawUps } = require('../utils/extractUpsBreakdown');
const { base } = require('../config/ups');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
)

const LABELS_BUCKET = 'labels';
const INVOICES_BUCKET = 'invoices';

const up = (s) => (typeof s === 'string' ? s.toUpperCase() : s);

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
    if (mime === 'application/pdf') return 'label.pdf';
    return 'label.bin';
}

async function downloadFromBucket(bucket, path) {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error) throw error;

    // Node pode receber Buffer, Blob ou stream
    if (!data) {
        throw new Error(`Supabase storage: resposta vazia para ${bucket}/${path}`);
    }

    // caso já seja Buffer
    if (Buffer.isBuffer(data)) {
        return data;
    }

    // Blob (tem arrayBuffer)
    if (typeof data.arrayBuffer === 'function') {
        const arrayBuffer = await data.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }

    // Stream async-iterable
    if (typeof data.getReader === 'function' || data.readable) {
        const chunks = [];
        for await (const chunk of data) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
    }

    // fallback desesperado
    return Buffer.from(data);
}

async function salvarEtiquetaNaStorage(cotacaoId, base64, mime = 'image/png') {
    try {
        let b64toSave = base64;
        if (mime === 'application/pdf') {
            try {
                b64toSave = await keepFirstPageFromPdfB64(base64);
            } catch (err) {
                console.error('Erro ao extrair primeira página do PDF da etiqueta:', err);
            }
        }
        const buf = Buffer.from(b64toSave, 'base64');
        const ext = guessLabelFilename(mime)
        const path = `cotacoes/${cotacaoId}/label-${Date.now()}.${ext}`;

        const { error } = await supabase
            .storage
            .from(LABELS_BUCKET)
            .upload(path, buf, { contentType: mime, upsert: false });

        if (error) throw error;

        await Cotacao.update(
            {
                etiqueta_path: path,
                etiqueta_created_at: new Date(),
                etiqueta_mime: mime,
                // se quiser já ir limpando:
                // etiqueta_base64: null,
            },
            { where: { id: cotacaoId } }
        );
    } catch (err) {
        console.error('Erro ao salvar etiqueta na storage:', err);
    }
}

async function salvarInvoiceNaStorage(cotacaoId, base64, mime = 'application/pdf') {
    try {
        let b64toSave = base64;
        if (mime === 'application/pdf') {
            try {
                b64toSave = await keepFirstPageFromPdfB64(base64);
            } catch (err) {
                console.error('Erro ao extrair primeira página do PDF da invoice:', err);
            }
        }
        const buf = Buffer.from(b64toSave, 'base64');
        const ext = guessLabelFilename(mime)
        const path = `cotacoes/${cotacaoId}/invoice-${Date.now()}.${ext}`;

        const { error } = await supabase
            .storage
            .from(INVOICES_BUCKET)
            .upload(path, buf, { contentType: mime, upsert: false });

        if (error) throw error;

        await Cotacao.update(
            {
                invoice_path: path,
                invoice_created_at: new Date(),
                invoice_mime: mime,
                // se quiser já ir limpando:
                // invoice_base64: null,
            },
            { where: { id: cotacaoId } }
        );
    } catch (err) {
        console.error('Erro ao salvar invoice na storage:', err);
    }
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

    const toNum = (v) => {
        if (v == null) return undefined;
        const n = Number(String(v).replace(',', '.'));
        return Number.isFinite(n) ? n : undefined;
    };

    const negRest = toNum(rated?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue);
    if (Number.isFinite(negRest)) return negRest;

    const negLegacy = toNum(rated?.NegotiatedRates?.NetSummaryCharges?.GrandTotal?.MonetaryValue);
    if (Number.isFinite(negLegacy)) return negLegacy;

    const transport = toNum(rated?.TransportationCharges?.MonetaryValue);
    if (Number.isFinite(transport)) return transport;

    const total = toNum(rated?.TotalCharges?.MonetaryValue);
    if (Number.isFinite(total)) return total;

    return undefined;
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

    if (!row) {
        return res.status(404).json({ error: 'Etiqueta não disponível' });
    }

    try {
        let buf;
        const mime = row.etiqueta_mime || 'image/png';

        if (row.etiqueta_path) {
            // [NEW] baixa do Supabase Storage
            buf = await downloadFromBucket(LABELS_BUCKET, row.etiqueta_path);
        } else if (row.etiqueta_base64) {
            // [LEGACY] ainda usa o base64 se não tiver path
            buf = Buffer.from(row.etiqueta_base64, 'base64');
        } else {
            return res.status(404).json({ error: 'Etiqueta não disponível' });
        }

        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Length', buf.length);
        res.setHeader('Content-Disposition', `attachment; filename="${guessLabelFilename(mime)}"`);
        return res.send(buf);
    } catch (err) {
        console.error('[DOWNLOAD ETIQUETA][ERROR]', err);
        return res.status(500).json({ error: 'Erro ao baixar etiqueta' });
    }
}

async function downloadInvoice(req, res) {
    const id = req.params.id;
    const row = await Cotacao.findByPk(id);

    if (!row) {
        return res.status(404).json({ error: 'Invoice não disponível' });
    }

    try {
        let buf;
        const mime = row.invoice_mime || 'application/pdf';

        if (row.invoice_path) {
            // [NEW] baixa direto do Supabase Storage
            buf = await downloadFromBucket(INVOICES_BUCKET, row.invoice_path);
        } else if (row.invoice_base64) {
            // [LEGACY] mantém lógica antiga enquanto ainda existir base64
            let b64 = row.invoice_base64;
            if (mime === 'application/pdf') {
                b64 = await keepFirstPageFromPdfB64(b64);
            }
            buf = Buffer.from(b64, 'base64');
        } else {
            return res.status(404).json({ error: 'Invoice não disponível' });
        }

        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Length', buf.length);
        res.setHeader('Content-Disposition', 'attachment; filename="invoice.pdf"');
        return res.send(buf);
    } catch (err) {
        console.error('[DOWNLOAD INVOICE][ERROR]', err);
        return res.status(500).json({ error: 'Erro ao baixar invoice' });
    }
}

async function createCotacaoReal(req, res) {
    const t = await sequelize.transaction();
    try {
        // ===== Auth =====
        const cliente_id = Number(req.cliente?.id ?? req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId);
        if (!cliente_id) { await t.rollback(); return res.status(401).json({ ok: false, error: 'Cliente não autenticado' }); }

        const {
            pedido_ref: pedido_ref_raw,
            pais_remetente, pais_dest,
            pedido, caixa, tracking_number, carrier,
            rate_payload,          // payload completo do carrier (UPS)
            preco_base,            // override do front (string "42,55" ok)
            freightValueNum        // compat antigo
        } = req.body || {};

        const pedido_ref = normRef(pedido_ref_raw);
        if (!pedido_ref) { await t.rollback(); return res.status(400).json({ ok: false, error: 'pedido_ref é obrigatório' }); }

        // ===== Carrega cliente (para aplicar plano) =====
        const cli = await Cliente.findByPk(cliente_id, { transaction: t });
        const plano = cli?.plano || null;

        // ===== Idempotência =====
        const existente = await Cotacao.findOne({
            where: { cliente_id, pedido_ref },
            attributes: ['id', 'pedido_ref', 'createdAt'],
            transaction: t,
            lock: Transaction.LOCK.UPDATE,
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

        // ===== Determinar precoBase (BASE SEM taxas) =====
        let precoBase = null;        // BASE (BaseServiceCharge negotiated/publicado)
        let carrierResp = null;
        let breakdown = null;        // { currency, base, serviceOptions, itemized[], total }

        const precoBaseOverride = toNumSafe(preco_base ?? freightValueNum);
        const overrideUsado = Number.isFinite(precoBaseOverride);

        if (overrideUsado) {
            // Usuário enviou a BASE manualmente
            precoBase = precoBaseOverride;

            if (rate_payload) {
                try {
                    const rateRaw = rate_payload?.RateResponse || rate_payload?.rateResponse || rate_payload?.raw || rate_payload;
                    breakdown = extractUpsBreakdown(rateRaw);
                } catch (_) { /* ignora */ }
            }
        } else if (rate_payload) {
            try {
                // Chama adaptador
                carrierResp = await cotarCarrier({ payload: rate_payload });

                // Extrai breakdown real da UPS
                const rateRaw =
                    carrierResp?.raw?.RateResponse || carrierResp?.raw?.rateResponse
                        ? carrierResp.raw
                        : rate_payload;
                breakdown = extractUpsBreakdown(rateRaw);

                // BASE preferida = breakdown.base (BaseServiceCharge negotiated/publicado)
                // precoBase =
                //     toNumSafe(breakdown?.base) ??
                //     toNumSafe(carrierResp?.precoBase) ??
                //     0;

                const baseFromBreakdown = Number.isFinite(breakdown?.base) ? Number(breakdown.base) : null;
                // const baseFromAdapter = Number.isFinite(carrierResp?.precoBase) ? Number(carrierResp.precoBase) : null;
                // Se não houver breakdown.base, aí sim caímos para o adapter
                precoBase = (baseFromBreakdown ?? 0);
            } catch (e) {
                await t.rollback();
                const status = e?.response?.status || 502;
                const upstream = e?.upstream || e?.response?.data;
                const msg = upstream?.message || upstream?.error_description || upstream?.error || e.message;
                return res.status(status).json({ ok: false, error: msg, upstream });
            }
        } else {
            await t.rollback();
            return res.status(400).json({
                ok: false,
                error: 'Envie preco_base (ou freightValueNum) OU rate_payload para cotação.',
            });
        }

        if (!Number.isFinite(precoBase)) {
            await t.rollback();
            return res.status(400).json({ ok: false, error: 'Carrier não retornou preço base' });
        }

        // Consolida valores UPS
        // const upsBase = toNumSafe(precoBase) ?? 0;  // BASE (BaseServiceCharge)
        const upsBase = Number.isFinite(breakdown?.base) ? Number(breakdown.base) : (toNumSafe(precoBase) ?? 0)
        const upsTotal =
            toNumSafe(breakdown?.total) ??
            toNumSafe(carrierResp?.negotiated) ??
            toNumSafe(carrierResp?.published) ??
            toNumSafe(carrierResp?.amount) ??
            (
                (Number.isFinite(breakdown?.base) ? toNumSafe(breakdown.base) : 0) +
                (Number.isFinite(breakdown?.serviceOptions) ? toNumSafe(breakdown.serviceOptions) : 0) +
                (Array.isArray(breakdown?.itemized) ? breakdown.itemized.reduce((a, b) => a + (toNumSafe(b.value) || 0), 0) : 0)
            ) ?? upsBase;

        const upsTaxesTotal = Math.max(0, upsTotal - upsBase);

        // ===== Aplicar plano =====
        function aplicarPlanoSafely(base, planoDoCliente) {
            let ajustado = base;
            let ajuste = 0;
            let plano_aplicado = planoDoCliente || 'default';
            try {
                if (typeof aplicarPlano === 'function') {
                    const ret = aplicarPlano(base, planoDoCliente);
                    if (typeof ret === 'number') {
                        ajustado = Number(ret) || base;
                        ajuste = ajustado - base;
                    } else if (ret && typeof ret === 'object') {
                        const prefer =
                            toNumSafe(ret.preco_final) ??
                            toNumSafe(ret.preco) ??
                            toNumSafe(ret.baseComAjuste) ??
                            toNumSafe(ret.valor) ??
                            base;
                        ajustado = Number(prefer) || base;
                        ajuste = toNumSafe(ret.ajuste) ?? (ajustado - base);
                        plano_aplicado = ret.plano_aplicado ?? plano_aplicado;
                    }
                }
            } catch (_) { /* segue com base */ }
            return {
                preco_final: Number.isFinite(ajustado) ? ajustado : base,
                ajuste: Number.isFinite(ajuste) ? ajuste : 0,
                plano_aplicado
            };
        }

        const pricingBase = aplicarPlanoSafely(upsBase, plano);
        const precoFinalCliente = (toNumSafe(pricingBase?.preco_final) ?? upsBase) + upsTaxesTotal;

        // ===== Monta o objeto de surcharges salvo (para UI)
        const pedidoJson = (pedido && typeof pedido === 'object') ? { ...pedido } : {};
        const currency =
            breakdown?.currency ??
            pedido?.moeda ??
            'USD';

        const svc = Number(breakdown?.serviceOptions) || 0;
        const items = Array.isArray(breakdown?.itemized)
            ? breakdown.itemized.map(it => ({
                code: up(it.code ?? it.Code ?? ''),
                label: it.label ?? it.Description ?? it.code ?? 'Surcharge',
                value: Number(it.value ?? it.MonetaryValue ?? 0) || 0,
            }))
            : [];

        let totalCalc =
            Number(breakdown?.total) ||
            (upsBase + svc + items.reduce((a, b) => a + (b.value || 0), 0));

        const hasRealItemized = items.length > 0;
        const consolidatedItems = [...items];
        if (!hasRealItemized) {
            const diff = Math.max(0, totalCalc - upsBase - svc);
            if (diff > 0.009) {
                consolidatedItems.unshift({
                    code: 'UPS-SUR',
                    label: 'UPS surcharges (consolidado)',
                    value: diff,
                });
            }
        }

        const savedSurcharges = {
            currency: currency || 'USD',
            // base: upsBase,          // BaseServiceCharge (sem taxas)
            base: Number.isFinite(breakdown?.base) ? Number(breakdown.base) : upsBase,
            serviceOptions: svc,
            itemized: consolidatedItems,   // taxas negociadas/publicadas ou consolidado
            total: totalCalc,              // negociado se houver
        };

        const carrierRawToSave =
            (carrierResp && (carrierResp.raw || carrierResp)) ||
            rate_payload ||
            null;

        pedidoJson.pricing = {
            plano_aplicado: pricingBase.plano_aplicado,
            preco_base: upsBase + pricingBase.ajuste,                 // BASE (BaseServiceCharge)
            preco_final: precoFinalCliente,      // BASE com plano + TAXAS UPS
            carrier: carrier ?? 'UPS',
            fonte_base: overrideUsado ? 'OVERRIDE' : 'UPS',
            currency,
            surcharges: savedSurcharges,
            carrier_total: upsTotal,
            ups_taxes_total: Math.max(0, upsTotal - upsBase),
            carrier_raw: carrierRawToSave,
        };

        // ===== Persistência =====
        const registro = await Cotacao.create({
            cliente_id,
            pedido_ref,
            debug: {
                cliente_id,
                plano_reportado: plano,
                preco_base_usado: upsBase
            },
            plano_aplicado: pricingBase.plano_aplicado,
            preco_base: upsBase,
            preco_final: precoFinalCliente,
            pais_remetente: pais_remetente ?? null,
            pais_dest: pais_dest ?? null,
            pedido: pedidoJson,
            surcharges: pedidoJson?.pricing?.surcharges || null,
            caixa: (caixa && typeof caixa === 'object') ? caixa : {},
            tracking_number: tracking_number ?? null,
            carrier: carrier ?? 'UPS',
            status_norm: 'CRIADO',
            last_tracking_at: null,
            data_coleta: null,
            ready_hora: null,
            close_hora: null,
        }, { transaction: t });

        if (req.body?.PickupCreationRequest) {
            try {
                const pickupBody = {
                    PickupCreationRequest: req.body.PickupCreationRequest,
                    cotacaoId: registro.id,
                };

                // reaproveita sua lógica atual de chamada da UPS:
                const url = `https://onlinetools.ups.com/api/pickupcreation/v2407/pickup`;
                const transId = `pickup-${Date.now()}`;
                let token = await getUpsToken();

                const doPost = async (bearer) =>
                    axios.post(url, pickupBody, {
                        headers: {
                            "Content-Type": "application/json",
                            "Accept": "application/json",
                            "Authorization": `Bearer ${bearer}`,
                            "transId": transId,
                            "transactionSrc": "exporta-digital",
                        },
                        timeout: 20000,
                    });

                let resp;
                try {
                    resp = await doPost(token);
                } catch (e) {
                    const status = e?.response?.status;
                    if (status === 401) {
                        token = await getUpsToken(true);
                        resp = await doPost(token);
                    } else {
                        throw e; // cai no catch de fora
                    }
                }

                const upsData = resp.data || {};
                console.log('[UPS][PICKUP][OK]', JSON.stringify(upsData, null, 2));
                // se quiser, dá pra gravar algo da resposta do pickup na cotação usando `registro.update(...)` com a mesma transação `t`
            } catch (errPickup) {
                // SE O PICKUP FALHAR → ROLLBACK + NÃO CRIA COTAÇÃO
                await t.rollback();
                // const { status, message, raw } = normalizeUpsError(errPickup);
                const status = errPickup?.response?.status || 502;
                const rawData = errPickup?.response?.data || errPickup;
                console.error(
                    '[UPS][PICKUP][ERROR]',
                    status,
                    JSON.stringify(rawData, null, 2)
                );
                const msgFromUps =
                    rawData?.response?.errors?.[0]?.message ||
                    rawData?.response?.errors?.[0]?.description ||
                    rawData?.fault?.faultstring ||
                    rawData?.error_description ||
                    rawData?.message;
                return res.status(status).json({
                    ok: false,
                    error: msgFromUps || 'Falha ao criar pickup na UPS.',
                    raw: rawData,
                });
            }
        }

        console.log('[DBG][RATE keys]', Object.keys((carrierResp?.raw || rate_payload) || {}));
        console.log('[DBG][EXTRACT]', extractUpsBreakdown(carrierResp?.raw || rate_payload));

        await t.commit();
        return res.json({
            ok: true,
            created: true,
            cotacao_id: registro.id,
            pedido_ref: registro.pedido_ref,
            preco_final: precoFinalCliente,
            plano_aplicado: pricingBase.plano_aplicado
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
        const {
            etiqueta_base64,
            etiqueta_mime,
            invoice_base64,
            invoice_mime,
            tracking_number,
            carrier,
        } = req.body || {};

        const cot = await Cotacao.findByPk(id);
        if (!cot) {
            return res.status(404).json({ ok: false, error: 'Cotação não encontrada' });
        }

        // Atualiza só campos "simples" direto na tabela
        const patch = {};
        if (typeof tracking_number === 'string' && tracking_number.trim()) {
            patch.tracking_number = tracking_number.trim();
        }
        if (typeof carrier === 'string' && carrier.trim()) {
            patch.carrier = carrier.trim();
        }

        if (Object.keys(patch).length) {
            await cot.update(patch);
        }

        // ===== LABEL → Supabase Storage =====
        if (typeof etiqueta_base64 === 'string' && etiqueta_base64.trim()) {
            const mime = typeof etiqueta_mime === 'string' && etiqueta_mime.trim()
                ? etiqueta_mime.trim()
                : 'application/pdf';

            await salvarEtiquetaNaStorage(cot.id, etiqueta_base64, mime);
        }

        // ===== INVOICE → Supabase Storage =====
        if (typeof invoice_base64 === 'string' && invoice_base64.trim()) {
            const mime = typeof invoice_mime === 'string' && invoice_mime.trim()
                ? invoice_mime.trim()
                : 'application/pdf';

            await salvarInvoiceNaStorage(cot.id, invoice_base64, mime);
        }

        // recarrega a cotação pra pegar paths atualizados
        await cot.reload();

        return res.json({
            ok: true,
            cotacao_id: cot.id,
            tracking_number: cot.tracking_number || null,
            has_label: !!cot.etiqueta_path || !!cot.etiqueta_base64,
            has_invoice: !!cot.invoice_path || !!cot.invoice_base64,
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
                    [
                        literal(`(COALESCE(etiqueta_base64, '') <> '' OR COALESCE(etiqueta_path, '') <> '')`),
                        'has_label'
                    ],
                    [
                        literal(`(COALESCE(invoice_base64, '') <> '' OR COALESCE(invoice_path, '') <> '')`),
                        'has_invoice'
                    ],
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

async function getCotacaoDetails(req, res) {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ ok: false, error: 'id inválido' });
        }

        const cot = await Cotacao.findByPk(id);
        if (!cot) return res.status(404).json({ ok: false, error: 'Cotação não encontrada' });

        const pedido = cot.pedido || {};
        const pricing = pedido.pricing || {};

        // 1) PRIORIDADE: usar surcharges salvas
        let sur = pricing.surcharges || null;

        // 2) Se não houver salvo, tenta reconstruir a partir do carrier_raw
        if (!sur) {
            const raw = pricing.carrier_raw || pedido.carrier_raw || null;
            const b = raw ? extractUpsBreakdown(raw) : null;

            if (b && (Number.isFinite(b.base) || Number.isFinite(b.total))) {
                const svc = Number(b.serviceOptions) || 0;
                const items = Array.isArray(b.itemized) ? b.itemized.map(it => ({
                    code: up(it?.code || it?.Code || ''),
                    label: it?.label || it?.Description || it?.code || 'Surcharge',
                    value: Number(it?.value ?? it?.MonetaryValue ?? 0) || 0,
                })) : [];

                let total = Number(b.total) ||
                    (Number(b.base) || 0) + svc + items.reduce((a, x) => a + (x.value || 0), 0);

                const finalItems = [...items];
                if (finalItems.length === 0) {
                    const diff = Math.max(0, total - (Number(b.base) || 0) - svc);
                    if (diff > 0.009) {
                        finalItems.unshift({ code: 'UPS-SUR', label: 'UPS surcharges (consolidado)', value: diff });
                    }
                }

                sur = {
                    currency: b.currency || 'USD',
                    base: Number(b.base) || 0,
                    serviceOptions: svc,
                    itemized: finalItems,
                    total,
                };
            }
        }

        const currency = sur?.currency || pricing?.currency || 'USD';
        const base = Number(pricing?.preco_base ?? cot.preco_base ?? sur?.base ?? 0);
        const total = Number(pricing?.preco_final ?? cot.preco_final ?? sur?.total ?? 0);

        const planAdj = Number(pricing?.ajuste || 0);
        const basePura = Number.isFinite(sur?.base) ? Number(sur.base) : (base - planAdj);
        const compare_total = Number.isFinite(pricing?.preco_base)
            ? Number(pricing.preco_base)       // já “aplicarPlano(base)”
            : (Number(basePura) + Number(planAdj));  // fallback: base + ajuste

        let itemized = Array.isArray(sur?.itemized)
            ? sur.itemized.map(i => ({
                code: up(i?.code ?? i?.Code ?? '') || undefined,
                label: i?.label ?? i?.Description ?? i?.code ?? 'Surcharge',
                value: Number(i?.value ?? i?.MonetaryValue ?? 0) || 0,
            }))
            : [];

        const svc = Number(sur?.serviceOptions || 0);
        if (svc) itemized.unshift({ code: 'SVC', label: 'Service options (UPS)', value: svc });

        // const planAdj = Number(pricing?.ajuste || 0);
        if (planAdj) {
            const planLabel = pricing?.plano_aplicado
                ? `Markup plano (${pricing.plano_aplicado})`
                : 'Markup plano';
            itemized.push({ code: 'PLAN', label: planLabel, value: planAdj });
        }

        if (itemized.filter(i => i.code !== 'PLAN' && i.code !== 'SVC').length === 0) {
            const already = planAdj + (svc || 0);
            const diff = (total || 0) - (base || 0) - already;
            if (diff > 0.009) {
                itemized.unshift({ code: 'UPS-SUR', label: 'UPS surcharges (consolidado)', value: diff });
            }
        }

        return res.json({
            ok: true,
            data: {
                id: cot.id,
                pedido_ref: cot.pedido_ref,
                currency,
                base,
                total,
                compare_total,
                serviceOptions: svc || undefined,
                itemized
            },
        });
    } catch (err) {
        console.error('[GET /cotacoes/:id/details]', err);
        return res.status(500).json({ ok: false, error: 'Erro ao buscar detalhes da cotação' });
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
    getCotacaoStatusByPedidoRef,
    getCotacaoDetails,
    salvarEtiquetaNaStorage,
    salvarInvoiceNaStorage,
};