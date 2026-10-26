// controllers/cotacoes.controller.js
const { Op, literal, fn, col, Transaction, Sequelize } = require('sequelize');
const { Cotacao, Cliente, PedidoImport, sequelize } = require('../models');
const { keepFirstPageFromPdfB64, mesclarEtiquetasEmPdfB64 } = require('../utils/pdfTools');
const { getStatusOnly } = require('../services/trackingStatus');
const { aplicarPlano, MARKUP_PCT } = require('../utils/regrasPlanos');
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
const { registrarEstimativaDaCotacao } = require('../services/landedCost');
const { valorConversao } = require('../utils/dolar');
const { desembaracoUsd } = require('../services/taxasTransportadora');
const { composicaoCotacao, situacaoPagamento, chaveDebito, chaveEstorno } = require('../services/cobrancaCotacao');
const { impostosBetaHabilitado } = require('../services/featureFlags');
const carteira = require('../services/carteira');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
)

const LABELS_BUCKET = 'labels';
const INVOICES_BUCKET = 'invoices';

function toInt(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function normRef(v) {
    return String(v || '').trim();
}
function sanitizeForStorageKey(value) {
    return String(value ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
        .replace(/[^a-zA-Z0-9._-]+/g, '_') // qualquer coisa fora do permitido pelo Supabase Storage vira _
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function guessLabelFilename(mime = '', pedido_ref, nomeCliente) {
    const ref = sanitizeForStorageKey(pedido_ref) || 'pedido';
    const nome = sanitizeForStorageKey(nomeCliente) || 'cliente';
    if (mime === 'image/png') return `${ref}-ET-${nome}.png`;
    if (mime === 'image/gif') return `${ref}-ET-${nome}.gif`;
    if (mime === 'text/plain') return `${ref}-ET-${nome}.zpl`;
    if (mime === 'application/pdf') return `${ref}-ET-${nome}.pdf`;
    return `${ref}-ET-${nome}.bin`;
}

function guessInvoiceFilename(mime = '', pedido_ref, nomeCliente) {
    const ref = sanitizeForStorageKey(pedido_ref) || 'pedido';
    const nome = sanitizeForStorageKey(nomeCliente) || 'cliente';
    if (mime === 'image/png') return `${ref}-IN-${nome}.png`;
    if (mime === 'image/gif') return `${ref}-IN-${nome}.gif`;
    if (mime === 'text/plain') return `${ref}-IN-${nome}.zpl`;
    if (mime === 'application/pdf') return `${ref}-IN-${nome}.pdf`;
    return `${ref}-IN-${nome}.bin`;
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

/**
 * Salva a etiqueta de um envio de N volumes. Com mais de uma, junta tudo num
 * PDF (uma página por volume) e salva como etiqueta da cotação — era aqui que
 * os volumes 2..N se perdiam, porque só a primeira etiqueta era guardada.
 *
 * @param {number} cotacaoId
 * @param {Array<{ b64: string, mime?: string }>} partes
 */
async function salvarEtiquetasNaStorage(cotacaoId, partes = []) {
    const lista = (Array.isArray(partes) ? partes : []).filter(
        (p) => p && typeof p.b64 === 'string' && p.b64.trim()
    );
    if (!lista.length) return;

    if (lista.length === 1) {
        await salvarEtiquetaNaStorage(cotacaoId, lista[0].b64, lista[0].mime || 'application/pdf');
        return;
    }

    const juntado = await mesclarEtiquetasEmPdfB64(lista);
    if (juntado) {
        await salvarEtiquetaNaStorage(cotacaoId, juntado, 'application/pdf');
        return;
    }

    // Formato que o pdf-lib não abre (ZPL): guarda a do primeiro volume, que é
    // o comportamento antigo, e registra para não sumir silenciosamente.
    console.error(
        '[ETIQUETA][MERGE] formatos não suportados, salvando só o volume 1:',
        lista.map((p) => p.mime || 'sem-mime').join(', ')
    );
    await salvarEtiquetaNaStorage(cotacaoId, lista[0].b64, lista[0].mime || 'application/pdf');
}

async function salvarInvoiceNaStorage(cotacaoId, base64, mime = 'application/pdf') {
    try {
        const cotacao = await db.Cotacao.findOne({
            where: { id: cotacaoId },
        })
        const nomeCliente = await db.Cliente.findOne({
            where: { id: cotacao?.cliente_id },
            attributes: ['razaoSocial'],
        })
        const razaoSocial = nomeCliente?.razaoSocial || 'cliente';
        const buf = Buffer.from(base64, 'base64');
        const ext = guessInvoiceFilename(mime, cotacao?.pedido_ref, razaoSocial)
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

/*
 * A trava de pagamento no download esta DESLIGADA.
 *
 * Decisao de 2026-10-26: bloquear a etiqueta e a invoice ate a remessa ser
 * paga deixava o cliente sem o documento que a alfandega pede, inclusive
 * depois de o pacote ja estar a caminho. O pagamento continua existindo e
 * pode ser feito pela carteira ou por boleto — so nao prende mais o
 * documento.
 *
 * Para religar sem novo deploy: TRAVA_DOCUMENTO_POR_PAGAMENTO=1. Com ela
 * ligada vale a regra antiga, que ja era mais branda que a original:
 * - CANCELADO -> bloqueado, e pagar nao muda isso;
 * - CRIADO    -> exige pagamento (so na allowlist da carteira);
 * - demais    -> liberado, o documento acompanha a carga.
 *
 * Cancelada segue bloqueada em qualquer caso: nao ha envio para documentar.
 */
const TRAVA_DOC_POR_PAGAMENTO =
    String(process.env.TRAVA_DOCUMENTO_POR_PAGAMENTO || '').trim() === '1';

async function liberacaoDocumento(row) {
    const status = String(row.status_norm || '').toUpperCase();

    if (status === 'CANCELADO') {
        return {
            liberado: false,
            http: 409,
            corpo: {
                error: 'Cotação cancelada: a documentação não fica mais disponível.',
                cancelada: true,
            },
        };
    }

    if (!TRAVA_DOC_POR_PAGAMENTO) return { liberado: true };

    if (status && status !== 'CRIADO') {
        return { liberado: true };
    }

    // So vale para quem esta na allowlist da carteira. As cotacoes que ja
    // existiam nunca passaram por este pagamento — ligar a trava para todo
    // mundo deixaria centenas de clientes sem baixar a propria etiqueta.
    const donoDaCotacao = await db.Cliente.findByPk(row.cliente_id);
    const pagamento = carteira.carteiraHabilitada(donoDaCotacao)
        ? await situacaoPagamento(row)
        : { pago: true, forma: 'fora_da_cobranca_antecipada' };

    if (pagamento.pago) return { liberado: true };

    return {
        liberado: false,
        http: 402,
        corpo: {
            error: 'Documento liberado após o pagamento da remessa.',
            pago: false,
            boleto_pendente: pagamento.boleto_pendente || false,
            boleto_url: pagamento.boleto_url || null,
        },
    };
}

async function downloadEtiqueta(req, res) {
    const id = req.params.id;

    // Escopo por cliente: era findByPk(id) solto, entao qualquer usuario
    // logado baixava a etiqueta de qualquer cotacao trocando o numero na URL.
    const cliente_id = Number(
        req.cliente?.id ?? req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId
    );
    if (!cliente_id) return res.status(401).json({ error: 'Cliente não autenticado' });

    const row = await Cotacao.findOne({ where: { id, cliente_id } });

    if (!row) {
        // Mesma resposta para "nao existe" e "nao e sua": nao vale dizer a um
        // estranho que a cotacao existe.
        return res.status(404).json({ error: 'Etiqueta não disponível' });
    }

    const liberacao = await liberacaoDocumento(row);
    if (!liberacao.liberado) {
        return res.status(liberacao.http).json(liberacao.corpo);
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

    // Mesmo furo da etiqueta, e aqui e pior: a commercial invoice traz nome,
    // endereco e valores da carga do cliente.
    const cliente_id = Number(
        req.cliente?.id ?? req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId
    );
    if (!cliente_id) return res.status(401).json({ error: 'Cliente não autenticado' });

    const row = await Cotacao.findOne({ where: { id, cliente_id } });

    if (!row) {
        return res.status(404).json({ error: 'Invoice não disponível' });
    }

    const liberacao = await liberacaoDocumento(row);
    if (!liberacao.liberado) {
        return res.status(liberacao.http).json(liberacao.corpo);
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
            serviceCode,
            pesoTotalPedidoKg,     // peso total dos itens (aba cotação) — sobrescreve Package.Weight na UPS
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
                pesoTotalPedidoKg,
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

        // O markup do plano incide sobre o total da transportadora (frete +
        // taxas), nao so sobre a base: e esse total com acrescimo que o cliente
        // ve na comparacao e paga na cotacao.
        const carrierTotalComTaxas = Number(
            (carrierBase + carrierTaxesTotal).toFixed(2)
        );
        const pricingBase = aplicarPlanoSafely(carrierTotalComTaxas, plano);
        const precoFinalCliente =
            toNumSafe(pricingBase?.preco_final) ?? carrierTotalComTaxas;

        // ===== Monta surcharges / pricing dentro do pedido =====
        const basePedido =
            pedido_manual && typeof pedido_manual === 'object'
                ? pedido_manual
                : (pedido && typeof pedido === 'object' ? pedido : {});
        const pedidoJson = { ...basePedido };

        pedidoJson.pricing = {
            plano_aplicado: pricingBase.plano_aplicado,
            // O markup fica embutido na base exibida: assim base + taxas fecha
            // exatamente o total, sem uma linha de acrescimo aparecendo pro
            // cliente no detalhe do envio. Os valores puros ficam guardados
            // abaixo (carrier_base / markup_valor) pra conferencia interna.
            preco_base: Number(
                (carrierBase + pricingBase.ajuste).toFixed(2)
            ),
            carrier_base: carrierBase,
            markup_valor: pricingBase.ajuste,
            markup_pct: MARKUP_PCT,
            preco_final: precoFinalCliente, // (BASE + TAXAS) + markup
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
            // Multi-volume: [{ base64 | url, mime }], uma entrada por caixa.
            etiquetas,
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
        // Envio multi-volume manda `etiquetas` (uma por caixa); os campos
        // antigos continuam valendo para quem manda uma só.
        const mimeDoCorpo = typeof etiqueta_mime === 'string' && etiqueta_mime.trim()
            ? etiqueta_mime.trim()
            : null;

        const entradasEtiqueta = Array.isArray(etiquetas)
            ? etiquetas.filter((e) => e && (e.base64 || e.url))
            : [];

        if (!entradasEtiqueta.length) {
            if (typeof etiqueta_base64 === 'string' && etiqueta_base64.trim()) {
                entradasEtiqueta.push({ base64: etiqueta_base64.trim(), mime: mimeDoCorpo });
            } else if (typeof etiqueta_url === 'string' && etiqueta_url.trim()) {
                // comentario informal: FedEx manda URL, entao baixa e salva igual UPS
                entradasEtiqueta.push({ url: etiqueta_url.trim(), mime: mimeDoCorpo });
            }
        }

        if (entradasEtiqueta.length) {
            const partes = [];

            for (const entrada of entradasEtiqueta) {
                const mimeEntrada = typeof entrada.mime === 'string' && entrada.mime.trim()
                    ? entrada.mime.trim()
                    : null;

                if (typeof entrada.base64 === 'string' && entrada.base64.trim()) {
                    partes.push({
                        b64: entrada.base64.trim(),
                        mime: mimeEntrada || 'application/pdf',
                    });
                    continue;
                }

                // Falha num volume nao derruba a chamada: a rota de ship ja
                // salvou as etiquetas no servidor, e o resto da chamada (tracking,
                // invoice) ainda precisa acontecer.
                try {
                    const fetched = await fetchUrlAsBase64(String(entrada.url).trim());
                    partes.push({
                        b64: fetched.b64,
                        mime: mimeEntrada || fetched.mime || 'application/pdf',
                    });
                } catch (errEtiqueta) {
                    console.error(
                        '[ETIQUETA][DOWNLOAD] falhou para',
                        String(entrada.url).slice(0, 120),
                        errEtiqueta?.message
                    );
                }
            }

            // Lista incompleta nao sobrescreve: melhor manter o que a rota de
            // ship salvou (com todos os volumes) do que gravar so uma parte.
            if (partes.length === entradasEtiqueta.length) {
                await salvarEtiquetasNaStorage(cot.id, partes);
            } else if (partes.length) {
                console.error(
                    '[ETIQUETA] baixou', partes.length, 'de', entradasEtiqueta.length,
                    'volumes; mantendo a etiqueta salva na emissao'
                );
            }
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

        // ===== ESTIMATIVA DE IMPOSTOS =====
        // Roda aqui porque é o momento em que a documentação sai: a partir da
        // invoice a mercadoria declarada não muda mais. Solta sem await: a
        // consulta com busca leva dezenas de segundos e o front está esperando
        // a resposta do upload, não do imposto. Falha só vira log.
        if (cot.invoice_path || cot.invoice_base64) {
            registrarEstimativaDaCotacao({ cotacao: cot, db })
                .catch((e) => console.error('[IMPOSTO][IA][HOOK]', cot.id, e?.message));
        }

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

/**
 * Lança o imposto REALMENTE cobrado, quando a fatura do desembaraço chega.
 * POST /cotacoes/:id/imposto-real  { valor, moeda?, fonte? }
 *
 * É o outro lado da estimativa: sem este número não dá para saber se a IA
 * acerta, e a margem de segurança continua sendo definida por opinião.
 */
async function registrarImpostoReal(req, res) {
    try {
        const cliente_id = toInt(req.clienteId);
        if (!cliente_id) return res.status(401).json({ ok: false, error: 'Cliente não autenticado' });

        const { id } = req.params;
        const { valor, moeda, fonte } = req.body || {};

        const bruto = Number(String(valor ?? '').replace(',', '.'));
        if (!Number.isFinite(bruto) || bruto < 0) {
            return res.status(400).json({ ok: false, error: 'valor inválido' });
        }

        const cot = await Cotacao.findOne({ where: { id, cliente_id } });
        if (!cot) return res.status(404).json({ ok: false, error: 'Cotação não encontrada' });

        const moedaNorm = String(moeda || 'USD').trim().toUpperCase();
        if (!['USD', 'BRL'].includes(moedaNorm)) {
            return res.status(400).json({ ok: false, error: 'moeda deve ser USD ou BRL' });
        }

        // Guarda nas duas moedas: o USD é o que compara com a estimativa (que
        // nasce em USD), o BRL é o que bate com o boleto.
        let fx = Number(await valorConversao());
        if (!Number.isFinite(fx) || fx <= 0) fx = 0;

        const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
        const realUsd = moedaNorm === 'USD' ? r2(bruto) : (fx ? r2(bruto / fx) : null);
        const realBrl = moedaNorm === 'BRL' ? r2(bruto) : r2(bruto * fx);

        await cot.update({
            imposto_real_usd: realUsd,
            imposto_real_brl: realBrl,
            imposto_real_fonte: String(fonte || 'manual').trim().slice(0, 32),
            imposto_real_em: new Date(),
        });

        let comparacao = null;
        if (cot.imposto_estimativa_id) {
            const snap = await db.ImpostoEstimativa.findByPk(cot.imposto_estimativa_id);
            if (snap && realUsd != null) {
                const base = Number(snap.imposto_usd_base);
                const cobrado = Number(snap.imposto_usd_com_margem);
                comparacao = {
                    estimado_usd: base,
                    cobrado_com_margem_usd: cobrado,
                    real_usd: realUsd,
                    erro_estimativa_pct: base > 0 ? r2(((realUsd - base) / base) * 100) : null,
                    // Positivo = a margem cobriu. Negativo = a Intrex teve prejuízo.
                    folga_usd: r2(cobrado - realUsd),
                };
            }
        }

        return res.json({
            ok: true,
            cotacao_id: cot.id,
            imposto_real_usd: realUsd,
            imposto_real_brl: realBrl,
            comparacao,
        });
    } catch (err) {
        console.error('registrarImpostoReal error:', err);
        return res.status(500).json({ ok: false, error: 'Erro ao registrar imposto real' });
    }
}

/**
 * Acurácia das estimativas contra o imposto realmente cobrado.
 * GET /cotacoes/impostos/acuracia
 *
 * É a tela que responde "a margem pode cair?" com número em vez de opinião.
 */
async function acuraciaImpostos(req, res) {
    try {
        const cliente_id = toInt(req.clienteId);
        if (!cliente_id) return res.status(401).json({ ok: false, error: 'Cliente não autenticado' });

        const linhas = await Cotacao.findAll({
            where: {
                cliente_id,
                imposto_real_usd: { [Op.ne]: null },
                imposto_estimativa_id: { [Op.ne]: null },
            },
            attributes: ['id', 'pais_dest', 'carrier', 'imposto_real_usd', 'imposto_estimativa_id', 'created_at'],
            order: [['created_at', 'DESC']],
            limit: 500,
        });

        if (!linhas.length) {
            return res.json({
                ok: true,
                amostra: 0,
                aviso: 'Nenhuma cotação com imposto real lançado ainda. A margem segue sem base medida.',
                casos: [],
            });
        }

        const snaps = await db.ImpostoEstimativa.findAll({
            where: { id: linhas.map((l) => l.imposto_estimativa_id) },
        });
        const porId = new Map(snaps.map((s) => [s.id, s]));

        const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
        const casos = [];

        for (const l of linhas) {
            const s = porId.get(l.imposto_estimativa_id);
            if (!s) continue;

            const base = Number(s.imposto_usd_base);
            const comMargem = Number(s.imposto_usd_com_margem);
            const real = Number(l.imposto_real_usd);

            casos.push({
                cotacao_id: l.id,
                pais_dest: l.pais_dest,
                confianca: s.raw_response?.confianca || null,
                margem_pct: Number(s.margem_pct),
                estimado_usd: base,
                cobrado_com_margem_usd: comMargem,
                real_usd: real,
                erro_pct: base > 0 ? r2(((real - base) / base) * 100) : null,
                folga_usd: r2(comMargem - real),
                cobriu: comMargem >= real,
            });
        }

        const comErro = casos.filter((c) => c.erro_pct != null);
        const media = (arr) => (arr.length ? r2(arr.reduce((a, b) => a + b, 0) / arr.length) : null);

        // Agrupa por confiança: é assim que se descobre se os 8/15/25% estão
        // calibrados, ou se algum nível está sistematicamente errado.
        const porConfianca = {};
        for (const c of comErro) {
            const k = c.confianca || 'sem_nivel';
            (porConfianca[k] ||= []).push(c);
        }

        const resumoConfianca = Object.fromEntries(
            Object.entries(porConfianca).map(([k, v]) => [k, {
                amostra: v.length,
                erro_medio_pct: media(v.map((c) => c.erro_pct)),
                erro_maximo_pct: r2(Math.max(...v.map((c) => c.erro_pct))),
                margem_aplicada_pct: v[0].margem_pct,
                cobriu_pct: r2((v.filter((c) => c.cobriu).length / v.length) * 100),
            }])
        );

        return res.json({
            ok: true,
            amostra: casos.length,
            erro_medio_pct: media(comErro.map((c) => c.erro_pct)),
            descobertas: casos.filter((c) => !c.cobriu).length,
            prejuizo_total_usd: r2(casos.filter((c) => !c.cobriu).reduce((a, c) => a + (c.real_usd - c.cobrado_com_margem_usd), 0)),
            por_confianca: resumoConfianca,
            casos,
        });
    } catch (err) {
        console.error('acuraciaImpostos error:', err);
        return res.status(500).json({ ok: false, error: 'Erro ao calcular acurácia' });
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
        // Imposto estimado: sem isto a lista nao tem como mostrar o total com
        // imposto, so o frete. `impostos_valor_brl` so vem preenchido em
        // enforce; em shadow fica null de proposito e o front mostra apenas a
        // estimativa, sem somar no total a pagar.
        impostos_valor_brl: c.impostos_valor_brl != null ? Number(c.impostos_valor_brl) : null,
        impostos_modo: c.impostos_modo || null,
        imposto_estimativa_id: c.imposto_estimativa_id || null,
        // Desembaraco da transportadora: nao vem no rate, e somado por fora e
        // entra no boleto. Sem devolver aqui, a tela mostrava um total menor
        // que o cobrado e a diferenca parecia cambio errado.
        desembaraco_usd: desembaracoUsd(c.carrier),
        createdAt: c.createdAt,
    };
}

/**
 * Monta o `where` da listagem a partir da query.
 *
 * Extraido de listCotacoes para o resumo das abas usar exatamente os mesmos
 * filtros. Se os dois montassem o filtro por conta propria, o contador da aba
 * diria um numero e a lista mostraria outro assim que um deles mudasse.
 *
 * `incluirStatus: false` e o que o resumo usa: ele precisa contar TODOS os
 * status para desenhar as abas, inclusive o que nao esta selecionado.
 */
function montarWhereCotacoes(cliente_id, query, { incluirStatus = true } = {}) {
    const {
        pedido_ref, tracking_number, date_from, date_to,
        only_with_tracking,
        search, start_day, end_day,
        status, carrier,
    } = query;
    const tzOffset = "-03:00";

    const where = { cliente_id };

    // Filtro por status_norm. Aceita lista separada por virgula
    // ("EXCECAO,EM_TRANSITO") para a tela de ocorrencias poder crescer sem
    // precisar de outro endpoint.
    if (incluirStatus && status) {
        const lista = String(status)
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean);

        if (lista.length === 1) where.status_norm = lista[0];
        else if (lista.length > 1) where.status_norm = { [Op.in]: lista };
    } else if (incluirStatus) {
        /*
         * Sem filtro explicito, cancelada nao aparece.
         *
         * Antes de o cancelamento virar estorno, a linha era destruida e
         * sumia sozinha da lista. Agora ela fica no banco — o estorno precisa
         * de uma referencia que continue existindo — e passou a aparecer na
         * listagem como se o envio ainda valesse. Quem cancela espera que
         * suma; o registro continua no banco, so nao na tela.
         *
         * Quem quiser ve-la pede explicitamente: ?status=CANCELADO.
         */
        where.status_norm = { [Op.ne]: 'CANCELADO' };
    }

    // Transportadora como filtro proprio. `search` ja olhava `carrier`, mas
    // por ali nao da para combinar "FEDEX" com uma busca por comprador: as
    // duas condicoes cairiam no mesmo OR.
    if (carrier && String(carrier).trim()) {
        where.carrier = String(carrier).trim().toUpperCase();
    }

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

    return where;
}

/**
 * Contagem por status e soma de frete + desembaraco, para o cabecalho e as
 * abas da tela de cotacoes.
 *
 * Existe porque a listagem e paginada: somar ou contar no front daria o
 * numero da pagina aberta, nao o do filtro inteiro. Agrupa por carrier
 * tambem porque o desembaraco e um valor fixo por transportadora, que nao
 * esta gravado na linha — vem de `desembaracoUsd`.
 */
async function resumoCotacoes(req, res) {
    try {
        const cliente_id = toInt(req.clienteId);
        if (!cliente_id) return res.status(401).json({ ok: false, error: 'Cliente não autenticado' });

        const where = montarWhereCotacoes(cliente_id, req.query, { incluirStatus: false });

        // Mesma regra da listagem: cancelada nao conta nas abas, senao o
        // numero de "Todas" ficaria maior que a lista que a aba mostra.
        where.status_norm = { [Op.ne]: 'CANCELADO' };

        const linhas = await Cotacao.findAll({
            where,
            attributes: [
                'status_norm',
                'carrier',
                [fn('COUNT', col('id')), 'qtd'],
                [fn('SUM', col('preco_final')), 'frete_usd'],
            ],
            group: ['status_norm', 'carrier'],
            raw: true,
        });

        let total = 0;
        let freteDesembaracoUsd = 0;
        const porStatus = {};

        for (const linha of linhas) {
            const qtd = Number(linha.qtd) || 0;
            const status = String(linha.status_norm || '').toUpperCase() || 'DESCONHECIDO';

            total += qtd;
            porStatus[status] = (porStatus[status] || 0) + qtd;
            freteDesembaracoUsd +=
                (Number(linha.frete_usd) || 0) + qtd * desembaracoUsd(linha.carrier);
        }

        return res.json({
            ok: true,
            total,
            por_status: porStatus,
            frete_desembaraco_usd: Number(freteDesembaracoUsd.toFixed(2)),
        });
    } catch (err) {
        console.error('❌ resumoCotacoes:', err);
        return res.status(500).json({ ok: false, error: 'Erro ao resumir cotações', detalhes: err.message });
    }
}

async function listCotacoes(req, res) {
    try {
        const cliente_id = toInt(req.clienteId);
        if (!cliente_id) return res.status(401).json({ ok: false, error: 'Cliente não autenticado' });

        const { page = 1, limit = 10, refresh } = req.query;

        const where = montarWhereCotacoes(cliente_id, req.query);

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

                const shouldBackfillDeliveredAt = (novo === 'ENTREGUE' && !plain.delivered_at);
                if (isNewer || changed || shouldBackfillDeliveredAt) {
                    const updates = {};

                    if (isNewer || changed) {
                        updates.status_norm = novo;
                        updates.last_tracking_at = eventTime;
                        updates.tracking_raw = raw; // se você quiser guardar o último evento “cru”
                    }

                    if (shouldBackfillDeliveredAt) {
                        updates.delivered_at = new Date();
                        plain.delivered_at = updates.delivered_at;
                    }

                    await r.update(updates);

                    if (isNewer || changed) {
                        plain.status_norm = novo;
                        plain.last_tracking_at = eventTime;
                    }

                    if (changed && sse?.broadcastStatusUpdate) {
                        sse.broadcastStatusUpdate({ cotacao_id: r.id, status_norm: novo });
                    }
                }
            } catch (e) {
                console.error('tracking refresh failed for', r.id, e?.message || e);
            }

            return cotacaoListDTO(plain);
        }));

        // Em shadow o imposto nao vai para impostos_valor_brl de proposito,
        // entao a lista nao teria numero nenhum para mostrar. O snapshot
        // guarda a estimativa dos dois jeitos: lemos dele para a tela poder
        // exibir "imposto estimado" sem que isso signifique cobranca.
        const idsEstimativa = itens
            .map((i) => i.imposto_estimativa_id)
            .filter(Boolean);

        if (idsEstimativa.length) {
            const snaps = await db.ImpostoEstimativa.findAll({
                where: { id: [...new Set(idsEstimativa)] },
                attributes: ['id', 'imposto_valor_brl', 'imposto_usd_com_margem', 'margem_pct', 'moeda'],
            });
            const porId = new Map(snaps.map((sn) => [sn.id, sn]));

            for (const item of itens) {
                const sn = porId.get(item.imposto_estimativa_id);
                if (!sn) continue;
                item.imposto_estimado_brl = sn.imposto_valor_brl != null ? Number(sn.imposto_valor_brl) : null;
                item.imposto_estimado_usd = sn.imposto_usd_com_margem != null ? Number(sn.imposto_usd_com_margem) : null;
                item.imposto_margem_pct = sn.margem_pct != null ? Number(sn.margem_pct) : null;
                // Em shadow a estimativa aparece na tela mas nao soma no total.
                item.imposto_cobrado = item.impostos_valor_brl != null;
            }
        }

        // Pago ou nao, para a lista poder travar o download sem precisar
        // perguntar cotacao por cotacao. Duas consultas por pagina, com os ids
        // que a pagina ja trouxe.
        const idsPagina = itens.map((i) => i.id).filter(Boolean);

        // Fora da allowlist da carteira nada e travado, entao tudo entra como
        // pago: e o comportamento que os clientes ja tinham.
        const clienteDaLista = await Cliente.findByPk(cliente_id);
        const cobrancaLigada = carteira.carteiraHabilitada(clienteDaLista);

        if (!cobrancaLigada) {
            for (const item of itens) {
                item.pago = true;
                item.forma_pagamento = null;
                item.boleto_pendente = false;
                item.boleto_url = null;
            }
        } else if (idsPagina.length) {
            const [debitos, boletos] = await Promise.all([
                db.CarteiraLancamento.findAll({
                    where: { chave: idsPagina.map((id) => chaveDebito(id)) },
                    attributes: ['chave'],
                }),
                db.AsaasBoletos.findAll({
                    where: { cotacaoId: idsPagina },
                    attributes: ['cotacaoId', 'status', 'bankSlipUrl'],
                    order: [['id', 'ASC']],
                }),
            ]);

            const pagosPorCarteira = new Set(debitos.map((d) => d.chave));
            const PAGO = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];
            const porCotacao = new Map();
            for (const b of boletos) porCotacao.set(b.cotacaoId, b);

            for (const item of itens) {
                const boleto = porCotacao.get(item.id);
                const viaCarteira = pagosPorCarteira.has(chaveDebito(item.id));
                const viaBoleto = !!boleto && PAGO.includes(String(boleto.status));

                item.pago = viaCarteira || viaBoleto;
                item.forma_pagamento = viaCarteira ? 'carteira' : (viaBoleto ? 'boleto' : null);
                item.boleto_pendente = !!boleto && String(boleto.status) === 'PENDING' && !item.pago;
                item.boleto_url = boleto?.bankSlipUrl || null;
            }
        }

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
        const id = Number(req.params.id);
        const cliente_id = Number(req.cliente?.id ?? req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId);

        if (!Number.isFinite(id)) {
            return res.status(400).json({ ok: false, error: 'id inválido' });
        }
        if (!cliente_id) {
            return res.status(401).json({ ok: false, error: 'Cliente não autenticado' });
        }

        const cot = await Cotacao.findOne({ where: { id, cliente_id } });
        if (!cot) return res.status(404).json({ ok: false, error: 'Cotação não encontrada' });

        const pedidoRef = cot.pedido_ref;

        // Estorno: o que foi pago volta como saldo na carteira, tanto para
        // quem pagou com saldo quanto para quem pagou boleto — decisão de
        // 2026-10-23, para nao ter devolucao de dinheiro por fora.
        //
        // A chave unica do livro faz o estorno ser idempotente: cancelar duas
        // vezes nao devolve o dinheiro duas vezes.
        const pagamento = await situacaoPagamento(cot);
        let estorno_centavos = 0;

        if (pagamento.pago && Number(pagamento.valor_centavos) > 0) {
            const r = await carteira.lancar({
                clienteId: cliente_id,
                tipo: 'estorno_envio',
                valorCentavos: Number(pagamento.valor_centavos),
                descricao: `Estorno do envio ${pedidoRef} (${cot.carrier})`,
                referenciaTipo: 'cotacao',
                referenciaId: cot.id,
                chave: chaveEstorno(cot.id),
            });

            if (r.criado) estorno_centavos = Number(pagamento.valor_centavos);
        }

        // Marca em vez de apagar. Com estorno no livro, destruir a linha
        // deixaria um lancamento apontando para uma cotacao inexistente e sem
        // rastro do que foi cancelado.
        //
        // ATENCAO: nao cancela a etiqueta na transportadora. Nao existe Cancel
        // Shipment (FedEx) nem Void Shipment (UPS) no sistema, entao a
        // etiqueta emitida continua valida e pode ser despachada mesmo depois
        // do estorno. A tela avisa quem cancela. Quando o void existir, entra
        // aqui, antes do estorno.
        await cot.update({ status_norm: 'CANCELADO' });

        await db.PedidoImport.update(
            { status: false },
            { where: { cliente_id, pedido_ref: pedidoRef } }
        );

        return res.json({
            ok: true,
            cancelada: true,
            // Mantido por compatibilidade: o front antigo lia `deleted`.
            deleted: true,
            estorno_centavos,
            forma_pagamento: pagamento.forma ?? null,
        });
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
        // valor comparável = o que o cliente paga, já com o markup do plano
        const compare_total = Number.isFinite(pricing?.preco_final)
            ? Number(pricing.preco_final)
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

        // Nao expoe o markup do plano como linha: ele ja vem embutido no
        // preco_base, entao base + taxas fecha o total sem revelar o acrescimo.
        // planAdj segue usado abaixo so pra nao duplicar valor em cotacao
        // antiga, gravada quando o markup ia separado em pricing.ajuste.

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

/** Cliente logado, do jeito que as rotas de cotacao resolvem em todo lugar. */
function clienteDaRequisicao(req) {
    return Number(
        req.cliente?.id ?? req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId
    );
}

async function cotacaoDoCliente(req, res) {
    const cliente_id = clienteDaRequisicao(req);
    if (!cliente_id) {
        res.status(401).json({ ok: false, error: 'Cliente não autenticado' });
        return null;
    }

    const row = await Cotacao.findOne({ where: { id: req.params.id, cliente_id } });
    if (!row) {
        res.status(404).json({ ok: false, error: 'Cotação não encontrada' });
        return null;
    }
    return row;
}

/**
 * GET /cotacoes/:id/cobranca
 * Quanto custa a remessa, como se compoe e se ja foi paga. E o que a tela do
 * valor consome antes de oferecer carteira ou boleto.
 */
async function getCobranca(req, res) {
    try {
        const cot = await cotacaoDoCliente(req, res);
        if (!cot) return;

        const composicao = await composicaoCotacao(cot);
        const dono = await Cliente.findByPk(cot.cliente_id);

        // Fora das allowlists a estimativa nem comeca e a cobranca nao trava
        // nada. Sem dizer isso, a tela ficava em "calculando..." para sempre
        // esperando algo que nunca ia rodar.
        const imposto_habilitado = impostosBetaHabilitado(dono);
        const cobranca_habilitada = carteira.carteiraHabilitada(dono);

        const pagamento = cobranca_habilitada
            ? await situacaoPagamento(cot)
            : { pago: true, forma: 'fora_da_cobranca_antecipada' };
        const saldo_centavos = await carteira.saldoCentavos(cot.cliente_id);

        // Em shadow `impostos_valor_brl` fica null, entao composicao.imposto_brl
        // vem 0 — e a tela mostrava "R$ 0,00" no imposto com o valor real
        // escondido atras de "ver detalhes". O snapshot tem o numero nos dois
        // modos: devolvemos para a linha poder dizer quanto e, deixando claro
        // que nao esta sendo cobrado.
        let imposto_estimado_brl = null;
        if (cot.imposto_estimativa_id) {
            const snap = await db.ImpostoEstimativa.findByPk(cot.imposto_estimativa_id, {
                attributes: ['imposto_valor_brl'],
            });
            if (snap?.imposto_valor_brl != null) {
                imposto_estimado_brl = Number(snap.imposto_valor_brl);
            }
        }

        return res.json({
            ok: true,
            cotacao_id: cot.id,
            carrier: cot.carrier,
            ...composicao,
            pagamento,
            saldo_centavos,
            saldo_suficiente: saldo_centavos >= composicao.total_centavos,
            // Sem estimativa a tela nao pode dizer "total": falta uma parcela.
            imposto_estimado: cot.imposto_estimativa_id != null,
            imposto_estimado_brl,
            imposto_habilitado,
            cobranca_habilitada,
            impostos_modo: cot.impostos_modo || null,
            breakdown: Array.isArray(cot.impostos_estimados) ? cot.impostos_estimados : [],
        });
    } catch (err) {
        console.error('[COBRANCA][GET]', err);
        return res.status(500).json({ ok: false, error: 'Erro ao calcular a cobrança' });
    }
}

/**
 * POST /cotacoes/:id/pagar-com-saldo
 * Debita a remessa inteira da carteira. A chave do lancamento e unica por
 * cotacao, entao clicar duas vezes nao cobra duas vezes.
 */
async function pagarComSaldo(req, res) {
    try {
        const cot = await cotacaoDoCliente(req, res);
        if (!cot) return;

        const jaPago = await situacaoPagamento(cot);
        if (jaPago.pago) {
            return res.json({ ok: true, ja_pago: true, pagamento: jaPago });
        }

        const composicao = await composicaoCotacao(cot);
        if (composicao.total_centavos <= 0) {
            return res.status(400).json({ ok: false, error: 'Cotação sem valor a cobrar.' });
        }

        const r = await carteira.debitar({
            clienteId: cot.cliente_id,
            valorCentavos: composicao.total_centavos,
            tipo: 'debito_envio',
            descricao: `Remessa ${cot.pedido_ref} (${cot.carrier})`.slice(0, 160),
            referenciaTipo: 'cotacao',
            referenciaId: cot.id,
            chave: chaveDebito(cot.id),
        });

        // Fecha o ciclo com o boleto em lote: cotacao paga pela carteira nao
        // pode ser varrida de novo para cobranca.
        await cot.update({ status_pagamento: 'GERADO' });

        return res.json({
            ok: true,
            pago: true,
            cobrado_centavos: composicao.total_centavos,
            saldo_centavos: r.saldo,
            composicao,
        });
    } catch (err) {
        if (err?.code === 'SALDO_INSUFICIENTE') {
            return res.status(402).json({
                ok: false,
                error: 'Saldo insuficiente na carteira.',
                saldo_centavos: err.saldo,
            });
        }
        console.error('[COBRANCA][PAGAR]', err);
        return res.status(500).json({ ok: false, error: 'Erro ao pagar com saldo' });
    }
}

module.exports = {
    getCobranca,
    pagarComSaldo,
    createCotacaoReal,
    attachDocs,
    getCotacao,
    listCotacoes,
    resumoCotacoes,
    updateCotacao,
    deleteCotacao,
    downloadEtiqueta,
    downloadInvoice,
    keepFirstPageFromPdfB64,
    getCotacaoStatusByPedidoRef,
    getCotacaoDetails,
    salvarEtiquetaNaStorage,
    salvarEtiquetasNaStorage,
    salvarInvoiceNaStorage,
    getCotacaoRemetente,
    registrarImpostoReal,
    acuraciaImpostos
};



