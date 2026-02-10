// controllers/cotacoes.controller.js
const { Op, literal, Transaction, Sequelize } = require('sequelize');
const { Cotacao, Cliente, PedidoImport, sequelize } = require('../models');
const { keepFirstPageFromPdfB64 } = require('../utils/pdfTools');
const { getStatusOnly } = require('../services/trackingStatus');
const { aplicarPlano } = require('../utils/regrasPlanos');
const { cotarCarrier } = require('../services/carriers');
const { sse } = require('../server'); // usa a mesma instância criada no app.js
const { extractUpsBreakdown, extractFromRawUps } = require('../utils/extractUpsBreakdown');
const { base } = require('../config/ups');
const { createClient } = require('@supabase/supabase-js');
const { getUpsToken } = require('../services/upsAuth');
const axios = require('axios');
const { prepararCotacaoUPS } = require('../services/ups/cotacaoUps');
const { toNumSafe, up, iso2Country } = require('../services/cotacoesHelpers');
const { prepararCotacaoFedex } = require('../services/fedex/cotacaoFedex');
const { id } = require('zod/v4/locales');
const db = require('../models');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
)

const LABELS_BUCKET = 'labels';
const INVOICES_BUCKET = 'invoices';

// const up = (s) => (typeof s === 'string' ? s.toUpperCase() : s);

function toInt(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function normRef(v) {
    return String(v || '').trim();
}
function guessLabelFilename(mime = '', pedido_ref, nomeCliente) {
    if (mime === 'image/png') return `${pedido_ref}-ET-${nomeCliente}.png`;
    if (mime === 'image/gif') return `${pedido_ref}-ET-${nomeCliente}.gif`;
    if (mime === 'text/plain') return `${pedido_ref}-ET-${nomeCliente}.zpl`;
    if (mime === 'application/pdf') return `${pedido_ref}-ET-${nomeCliente}.pdf`;
    return `${pedido_ref}-ET-${nomeCliente}.bin`;
}

function guessInvoiceFilename(mime = '', pedido_ref, nomeCliente) {
    if (mime === 'image/png') return `${pedido_ref}-IN-${nomeCliente}.png`;
    if (mime === 'image/gif') return `${pedido_ref}-IN-${nomeCliente}.gif`;
    if (mime === 'text/plain') return `${pedido_ref}-IN-${nomeCliente}.zpl`;
    if (mime === 'application/pdf') return `${pedido_ref}-IN-${nomeCliente}.pdf`;
    return `${pedido_ref}-IN-${nomeCliente}.bin`;
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
        const cotacao = await db.Cotacao.findOne({
            where: { id: cotacaoId },
        })
        const nomeCliente = await db.Cliente.findOne({
            where: { id: cotacao?.cliente_id },
            attributes: ['razaoSocial'],
        })
        const razaoSocial = nomeCliente?.razaoSocial || 'cliente';
        const buf = Buffer.from(b64toSave, 'base64');
        const ext = guessLabelFilename(mime, cotacao?.pedido_ref, razaoSocial);
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

        const cotacao = await db.Cotacao.findOne({
            where: { id: row.id },
        })
        const nomeCliente = await db.Cliente.findOne({
            where: { id: cotacao?.cliente_id },
            attributes: ['razaoSocial'],
        })

        const razaoSocial = nomeCliente?.razaoSocial || 'cliente';

        if (row.etiqueta_path) {
            // [NEW] baixa do Supabase Storage
            buf = await downloadFromBucket(LABELS_BUCKET, row.etiqueta_path);
        } else if (row.etiqueta_base64) {
            // [LEGACY] ainda usa o base64 se não tiver path
            buf = Buffer.from(row.etiqueta_base64, 'base64');
        } else {
            return res.status(404).json({ error: 'Etiqueta não disponível' });
        }

        const filename = guessLabelFilename(mime, row.pedido_ref, razaoSocial);

        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Length', buf.length);
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
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
        const cotacao = await db.Cotacao.findOne({
            where: { id: row.id },
        })
        const nomeCliente = await db.Cliente.findOne({
            where: { id: cotacao?.cliente_id },
            attributes: ['razaoSocial'],
        })

        const razaoSocial = nomeCliente?.razaoSocial || 'cliente';
        console.log(row.pedido_ref)

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

        const filename = guessInvoiceFilename(mime, row.pedido_ref, razaoSocial);

        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Length', buf.length);
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
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
            pedido_manual,
            pais_remetente,
            pais_dest,
            pedido,
            caixa,
            tracking_number,
            carrier,
            rate_payload,          // payload completo do carrier (UPS)
            preco_base,            // override do front (string "42,55" ok)
            freightValueNum,        // compat antigo
            serviceCode
        } = req.body || {};

        const pedido_ref =
            normRef(pedido_ref_raw) ||
            normRef(pedido_manual?.ref || pedido_manual?.pedido_ref || pedido_manual?.id_envio || '');
        if (!pedido_ref && !pedido_manual) { await t.rollback(); return res.status(400).json({ ok: false, error: 'pedido é obrigatório' }); }

        // ===== Carrega cliente (para aplicar plano) =====
        const cli = await Cliente.findByPk(cliente_id, { transaction: t });
        const plano = cli?.plano || null;

        // ===== Idempotência =====
        const existente = await Cotacao.findOne({
            where: { cliente_id, pedido_ref, carrier },
            attributes: ['id', 'pedido_ref', 'carrier', 'createdAt'],
            transaction: t,
            lock: Transaction.LOCK.UPDATE,
        });
        if (existente) {
            await t.rollback();
            return res.status(409).json({
                ok: false, created: false,
                cotacao_id: existente.id,
                pedido_ref: existente.pedido_ref,
                carrier: existente.carrier,
                error: 'Já existe uma cotação para este pedido'
            });
        }

        //ESCOLHENDO A TRANSPORTADORA

        let carrierResult; //transportadora escolhida

        if (carrier == "UPS") {
            carrierResult = await prepararCotacaoUPS({
                req,
                rate_payload,
                preco_base,
                freightValueNum,
                plano,
            });
        } else if (carrier == "FEDEX") {
            carrierResult = await prepararCotacaoFedex({
                req,
                rate_payload,
                preco_base,
                freightValueNum,
                plano,
            });
        }
        else {
            await t.rollback();
            return res.status(400).json({ ok: false, error: "Carrier inválido" });
        }

        if (!carrierResult || !Number.isFinite(carrierResult.base)) {
            await t.rollback();
            return res
                .status(400)
                .json({ ok: false, error: 'Carrier não retornou preço base' });
        }


        const {
            carrier: carrierCode,
            base: carrierBase,
            total: carrierTotal,
            taxesTotal,
            currency,
            surcharges: savedSurcharges,
            carrier_raw,
            fonte_base,
        } = carrierResult;

        const carrierTaxesTotal = Number.isFinite(taxesTotal)
            ? taxesTotal
            : Math.max(0, carrierTotal - carrierBase);

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

        const pricingBase = aplicarPlanoSafely(carrierBase, plano);
        const precoFinalCliente =
            (toNumSafe(pricingBase?.preco_final) ?? carrierBase) +
            carrierTaxesTotal;

        // ===== Monta surcharges / pricing dentro do pedido =====
        const basePedido =
            pedido_manual && typeof pedido_manual === 'object'
                ? pedido_manual
                : (pedido && typeof pedido === 'object' ? pedido : {});
        const pedidoJson = { ...basePedido };

        pedidoJson.pricing = {
            plano_aplicado: pricingBase.plano_aplicado,
            preco_base: carrierBase + pricingBase.ajuste, // BASE com plano aplicado
            preco_final: precoFinalCliente, // BASE + TAXAS
            carrier: carrierCode,
            fonte_base: fonte_base || 'CARRIER',
            currency: currency || 'USD',
            surcharges: savedSurcharges,
            carrier_total: carrierTotal,
            // compat com código antigo (só preenche quando for UPS):
            ups_taxes_total:
                carrierCode === 'UPS' ? carrierTaxesTotal : undefined,
            // carrier_raw: carrier_raw,
            serviceCode
        };

        const service_code =
            serviceCode != null ? String(serviceCode).trim() : null;

        // opcional, mas ajuda a ter no JSON também
        if (service_code) {
            pedidoJson.serviceCode = service_code;
        }

        // comentario informal: tenta preencher pais mesmo se o front nao mandar
        if (!pedidoJson.pais && pedidoJson?.endereco?.pais) {
            pedidoJson.pais = pedidoJson.endereco.pais;
        }
        const paisRemetenteNorm =
            iso2Country(pais_remetente ?? cli?.dataValues?.enderecoPais) || null;
        const paisDestNorm =
            iso2Country(pais_dest ?? pedidoJson?.pais) || null;

        let status_pagamento = null
        if (carrier == "FEDEX") {
            status_pagamento = 'NAOGERADO';
        }

        const registro = await Cotacao.create(
            {
                cliente_id,
                pedido_ref,
                debug: {
                    cliente_id,
                    plano_reportado: plano,
                    preco_base_usado: carrierBase,
                },
                plano_aplicado: pricingBase.plano_aplicado,
                preco_base: carrierBase,
                preco_final: precoFinalCliente,
                pais_remetente: paisRemetenteNorm,
                pais_dest: paisDestNorm,
                pedido: pedidoJson,
                surcharges: pedidoJson?.pricing?.surcharges || null,
                caixa:
                    caixa && typeof caixa === 'object'
                        ? caixa
                        : {},
                tracking_number: tracking_number ?? null,
                status_norm: 'CRIADO',
                last_tracking_at: null,
                data_coleta: null,
                ready_hora: null,
                close_hora: null,
                carrier: carrierCode,
                serviceCode: carrierResult?.serviceCode ?? service_code,
                status_pagamento: status_pagamento,
            },
            { transaction: t }
        );

        // Atualiza status do pedido para COTADO (se existir no pedidos_importados)
        if (pedido_ref) {
            await PedidoImport.update(
                { status: "true" },
                { where: { cliente_id, pedido_ref }, transaction: t }
            );

            // Se o hscode veio no input, persistir nos itens de pedidos_importados
            if (Array.isArray(pedidoJson?.itens) && pedidoJson.itens.length) {
                const pedRow = await PedidoImport.findOne({
                    where: { cliente_id, pedido_ref },
                    transaction: t,
                    lock: Transaction.LOCK.UPDATE,
                });
                if (pedRow) {
                    const orig = Array.isArray(pedRow.itens) ? pedRow.itens : [];
                    const incoming = pedidoJson.itens;

                    const bySku = new Map();
                    for (const it of incoming) {
                        if (!it || !it.sku) continue;
                        bySku.set(String(it.sku).trim().toUpperCase(), it);
                    }

                    const pickHs = (it) => {
                        const hs =
                            it?.hscode ??
                            it?.hs_code ??
                            it?.hsCode ??
                            it?.harmonizedCode ??
                            it?.harmonizedSystemCode ??
                            it?.hs;
                        return hs != null && String(hs).trim() ? String(hs).trim() : "";
                    };

                    let merged = [];
                    if (orig.length) {
                        merged = orig.map((it, idx) => {
                            const inc =
                                (it?.sku && bySku.get(String(it.sku).trim().toUpperCase())) ||
                                incoming[idx];
                            const hs = pickHs(inc);
                            return hs ? { ...it, hscode: hs } : it;
                        });
                    } else {
                        merged = incoming.map((it) => {
                            const hs = pickHs(it);
                            return hs ? { ...it, hscode: hs } : it;
                        });
                    }

                    await PedidoImport.update(
                        { itens: merged },
                        { where: { cliente_id, pedido_ref }, transaction: t }
                    );
                }
            }
        }

        await t.commit();
        return res.json({
            ok: true,
            created: true,
            cotacao_id: registro.id,
            pedido_ref: registro.pedido_ref,
            preco_final: precoFinalCliente,
            plano_aplicado: pricingBase.plano_aplicado,
            carrier: carrierCode,
        });
    } catch (err) {
        try { await t.rollback(); } catch (_) { }
        console.error('[COTACAO][ERROR]', {
            message: err?.message,
            name: err?.name,
            parent: err?.parent?.message,
            detail: err?.parent?.detail,
            sql: err?.sql,
            code: err?.parent?.code,
            errors: err?.errors?.map?.(e => ({ message: e.message, path: e.path, value: e.value })),
            stack: err?.stack,
        });

        return res.status(500).json({
            ok: false,
            error: err?.message || 'Erro ao criar cotação',
        });
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
            etiqueta_url,
            invoice_url,
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

        async function fetchUrlAsBase64(url) {
            const resp = await axios.get(url, { responseType: 'arraybuffer' });
            const mime = resp?.headers?.['content-type'] || null;
            const b64 = Buffer.from(resp.data).toString('base64');
            return { b64, mime };
        }
        // ===== LABEL -> Supabase Storage =====
        if (typeof etiqueta_base64 === 'string' && etiqueta_base64.trim()) {
            const mime = typeof etiqueta_mime === 'string' && etiqueta_mime.trim()
                ? etiqueta_mime.trim()
                : 'application/pdf';

            await salvarEtiquetaNaStorage(cot.id, etiqueta_base64, mime);
        } else if (typeof etiqueta_url === 'string' && etiqueta_url.trim()) {
            // comentario informal: FedEx manda URL, entao baixa e salva igual UPS
            const fetched = await fetchUrlAsBase64(etiqueta_url.trim());
            const mime = typeof etiqueta_mime === 'string' && etiqueta_mime.trim()
                ? etiqueta_mime.trim()
                : (fetched.mime || 'application/pdf');
            await salvarEtiquetaNaStorage(cot.id, fetched.b64, mime);
        }

        // ===== INVOICE -> Supabase Storage =====
        if (typeof invoice_base64 === 'string' && invoice_base64.trim()) {
            const mime = typeof invoice_mime === 'string' && invoice_mime.trim()
                ? invoice_mime.trim()
                : 'application/pdf';

            await salvarInvoiceNaStorage(cot.id, invoice_base64, mime);
        } else if (typeof invoice_url === 'string' && invoice_url.trim()) {
            // comentario informal: mesma coisa pra invoice via URL
            const fetched = await fetchUrlAsBase64(invoice_url.trim());
            const mime = typeof invoice_mime === 'string' && invoice_mime.trim()
                ? invoice_mime.trim()
                : (fetched.mime || 'application/pdf');
            await salvarInvoiceNaStorage(cot.id, fetched.b64, mime);
        }

        // recarrega a cotacao pra pegar paths atualizados
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

function cotacaoListDTO(c) {
    return {
        id: c.id,
        pais_remetente: c.pais_remetente,
        pais_dest: c.pais_dest,
        pedido_ref: c.pedido_ref,
        pedido: c.pedido,
        caixa: c.caixa,
        etiqueta_path: c.etiqueta_path || null,
        invoice_path: c.invoice_path || null,
        tracking_number: c.tracking_number || null,
        status_norm: c.status_norm || 'CRIADO',
        tracking_raw: c.tracking_raw || null,
        plano_aplicado: c.plano_aplicado || null,
        preco_base: c.preco_base || null,
        preco_final: c.preco_final || null,
        carrier: c.carrier || null,
        surcharges: c.surcharges || null,
        status_pagamento: c.status_pagamento || null,
        createdAt: c.createdAt,
    };
}

async function listCotacoes(req, res) {
    try {
        const cliente_id = toInt(req.clienteId);
        if (!cliente_id) return res.status(401).json({ ok: false, error: 'Cliente não autenticado' });

        const {
            pedido_ref, tracking_number, date_from, date_to,
            page = 1, limit = 10,
            only_with_tracking,
            refresh, search, start_day, end_day
        } = req.query;
        const tzOffset = "-03:00";

        const where = { cliente_id };

        if (search && String(search).trim()) {
            const q = `%${String(search).trim()}%`;

            where[Op.or] = [
                { pedido_ref: { [Op.iLike]: q } },
                { tracking_number: { [Op.iLike]: q } },
                { carrier: { [Op.iLike]: q } },

                Sequelize.where(Sequelize.json("pedido.nomeComprador"), { [Op.iLike]: q }),
                Sequelize.where(Sequelize.json("pedido.emailComprador"), { [Op.iLike]: q }),
            ];
        }

        // ✅ INTERVALO opcional (start_day / end_day) no createdAt
        if ((start_day && String(start_day).trim()) || (end_day && String(end_day).trim())) {
            const range = {};

            if (start_day && String(start_day).trim()) {
                range[Op.gte] = new Date(`${String(start_day).trim()}T00:00:00${tzOffset}`);
            }

            if (end_day && String(end_day).trim()) {
                range[Op.lte] = new Date(`${String(end_day).trim()}T23:59:59.999${tzOffset}`);
            }

            where.createdAt = range; // (createdAt -> created_at)
        }

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
            // Remove carrier_raw do JSON pedido para reduzir payload em cotações antigas
            const statusNorm = plain.status_norm || 'CRIADO';
            const tn = plain.tracking_number;

            // ❌ Sem tracking -> não tenta normalizar.
            if (!tn) return cotacaoListDTO(plain);

            // Evita refresh agressivo em cotações recém-criadas
            const createdAtMs = new Date(plain.createdAt).getTime();
            const nowMs = Date.now();
            const ageMin = (nowMs - createdAtMs) / 60000;

            const lastAt = plain.last_tracking_at ? new Date(plain.last_tracking_at).getTime() : 0;
            const elapsedMin = (nowMs - lastAt) / 60000;

            // 🔒 Quarentena de 30min para cotação “CRIADO” sem tracking visto ainda (evita falso trânsito)
            if (!forceRefresh && statusNorm === 'CRIADO' && !lastAt && ageMin < 30) {
                return cotacaoListDTO(plain); // mantém CRIADO
            }

            if (!forceRefresh && lastAt && elapsedMin < REFRESH_COOLDOWN_MIN) {
                return cotacaoListDTO(plain); // respeita cooldown
            }

            try {
                const carrier = plain.carrier;
                if (!plain.carrier) {
                    throw new Error('Carrier não definido na cotação');
                }

                const { status_norm: novo, last_event, raw } = await getStatusOnly({
                    carrier,
                    trackingNumber: tn,
                });

                if (!novo) return cotacaoListDTO(plain);

                const nowMs = Date.now();
                const eventTime = last_event ? new Date(last_event) : new Date(nowMs);
                const isNewer = !plain.last_tracking_at || eventTime > new Date(plain.last_tracking_at);
                const changed = (plain.status_norm || 'CRIADO') !== novo;

                if ((isNewer || changed)) {
                    const updates = {
                        status_norm: novo,
                        last_tracking_at: eventTime,
                        tracking_raw: raw, // se você quiser guardar o último evento “cru”
                    };

                    if (novo === 'ENTREGUE' && !plain.delivered_at) {
                        updates.delivered_at = new Date();
                    }

                    await r.update(updates);

                    plain.status_norm = novo;
                    plain.last_tracking_at = eventTime;

                    if (sse?.broadcastStatusUpdate) {
                        sse.broadcastStatusUpdate({ cotacao_id: r.id, status_norm: novo });
                    }
                }
            } catch (e) {
                console.error('tracking refresh failed for', r.id, e?.message || e);
            }

            return cotacaoListDTO(plain);
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

        const carrierCode = String(pricing?.carrier || cot.carrier || '').toUpperCase();
        const consolidatedCode = carrierCode === 'FEDEX' ? 'FEDEX-SUR' : 'UPS-SUR';
        const consolidatedLabel = carrierCode === 'FEDEX'
            ? 'FedEx surcharges (consolidado)'
            : 'UPS surcharges (consolidado)';

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
                itemized.unshift({ code: consolidatedCode, label: consolidatedLabel, value: diff });
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

async function getCotacaoRemetente(req, res) {
    const { id } = req.params;
    const cliente_id = Number(
        req.cliente?.id ?? req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId
    );

    if (!cliente_id) return res.status(401).json({ ok: false, error: "Cliente não autenticado." });

    const cot = await Cotacao.findByPk(id, { attributes: ["id", "cliente_id"] });
    if (!cot || Number(cot.cliente_id) !== cliente_id) {
        return res.status(404).json({ ok: false, error: "Cotação não encontrada." });
    }

    const cli = await Cliente.findByPk(cliente_id, {
        attributes: [
            "razaoSocial",
            "telefoneCelular",
            "emailPrincipal",
            "enderecoRua",
            "enderecoNumero",
            "enderecoComplemento",
            "enderecoCidade",
            "enderecoEstado",
            "enderecoCEP",
            "enderecoPais",
            "cnpj",
        ],
    });

    if (!cli) return res.status(404).json({ ok: false, error: "Cliente não encontrado." });

    return res.json({
        ok: true,
        remetente: {
            nome: cli.razaoSocial,
            telefone: cli.telefoneCelular,
            email: cli.emailPrincipal,
            rua: cli.enderecoRua,
            numero: cli.enderecoNumero,
            complemento: cli.enderecoComplemento,
            cidade: cli.enderecoCidade,
            estado: cli.enderecoEstado,
            cep: cli.enderecoCEP,
            pais: cli.enderecoPais,
            cnpjOuTaxId: cli.cnpj,
        },
    });
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
    getCotacaoRemetente
};



