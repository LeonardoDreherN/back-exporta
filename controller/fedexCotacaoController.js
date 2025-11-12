// controllers/cotacoesFedex.controller.js
const axios = require('axios');
const { Transaction } = require('sequelize');
const { Cotacao, Cliente, sequelize } = require('../models');
const { aplicarPlano } = require('../utils/regrasPlanos');
const { extractFedexBreakdown } = require('../utils/extractFedexBreakdown');
const fedexCfg = require('../config/fedex');

// ===== Helpers =====
const up = (s) => (typeof s === 'string' ? s.toUpperCase() : s);
const normRef = (v) => String(v || '').trim();

const toNumSafe = (v) => {
    if (v == null) return undefined;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
};

const pick = (o, path, def = null) => {
    try {
        return path.split('.').reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), o) ?? def;
    } catch {
        return def;
    }
};

// ===== OAuth FedEx =====
async function getFedexToken() {
    const { clientId, clientSecret, oauth, timeoutMs, scope } = fedexCfg;
    if (!clientId || !clientSecret) throw new Error('FEDEX clientId/clientSecret ausentes');

    const attempts = [scope?.trim(), null, 'oob', 'ship'].filter(v => v !== undefined);
    let last;

    for (const sc of attempts) {
        const body = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            ...(sc ? { scope: sc } : {}),
        });

        console.log('[FEDEX OAUTH][TRY]', { url: oauth, scope: sc || '(none)', AMBIENTE: process.env.FEDEX_AMBIENTE });

        let resp;
        try {
            resp = await axios.post(oauth, body.toString(), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: timeoutMs ?? 60000,
                validateStatus: () => true,
            });
        } catch (e) {
            console.error('[FEDEX OAUTH][NETWORK ERROR]', { message: e.message, code: e.code, url: oauth });
            last = { status: 0, data: { error: 'network', message: e.message } };
            continue;
        }

        if (resp.status === 200 && resp.data?.access_token) {
            console.log('[FEDEX OAUTH][OK]', { scope: sc || '(none)' });
            return resp.data.access_token;
        }

        console.error('[FEDEX OAUTH][HTTP ERROR]', { scope: sc || '(none)', status: resp.status, data: resp.data });
        last = { status: resp.status, data: resp.data };
    }

    // lance erro com o payload original da FedEx
    const msg = `FedEx OAuth ${last?.status}: ${JSON.stringify(last?.data)}`;
    throw new Error(msg);
}

// ===== Aplicar Plano (idêntico à UPS) =====
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
        plano_aplicado,
    };
}

// ===== RATE (createCotacaoReal) =====
async function createCotacaoRealFedex(req, res) {
    const t = await sequelize.transaction();
    try {
        // ===== Auth =====
        const cliente_id = Number(req.cliente?.id ?? req.clienteId ?? req.usuario?.clienteId ?? req.user?.clienteId ?? req.body?.cliente_id);
        if (!cliente_id) { await t.rollback(); return res.status(401).json({ ok: false, error: 'Cliente não autenticado' }); }

        const {
            pedido_ref: pedido_ref_raw,
            pais_remetente, pais_dest,
            pedido, caixa, tracking_number, carrier,
            rate_payload,        // payload completo do RATE FedEx
            preco_base,          // override manual (aceita "42,55")
            freightValueNum      // compat antigo
        } = req.body || {};

        const pedido_ref = normRef(pedido_ref_raw);
        if (!pedido_ref) { await t.rollback(); return res.status(400).json({ ok: false, error: 'pedido_ref é obrigatório' }); }

        // ===== Carrega cliente (para aplicar plano) =====
        const cli = await Cliente.findByPk(cliente_id, { transaction: t });
        const plano = cli?.plano || null;

        // ===== Idempotência (cliente_id + pedido_ref) =====
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

        // ===== Determinar BASE (sem taxas) =====
        let precoBase = null;    // BASE (ServiceCharge) da FedEx
        let breakdown = null;    // { currency, base, serviceOptions, itemized[], total }
        const precoBaseOverride = toNumSafe(preco_base ?? freightValueNum);
        const overrideUsado = Number.isFinite(precoBaseOverride);

        if (overrideUsado) {
            precoBase = precoBaseOverride;
            if (rate_payload) {
                try { breakdown = extractFedexBreakdown(rate_payload, rate_payload?.requestedShipment?.serviceType); } catch { }
            }
        } else if (rate_payload) {
            try {
                // Aqui não chamamos adaptador externo; usamos o próprio payload FedEx (rate response)
                // Se você estiver mandando o "request" e quer que eu chame a API, descomente este bloco:
                // const token = await getFedexToken();
                // const axiosResp = await axios.post(fedexCfg.rateQuotes, rate_payload, {
                //   headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                //   timeout: fedexCfg.timeoutMs, validateStatus: () => true,
                // });
                // if (axiosResp.status >= 400) {
                //   await t.rollback();
                //   return res.status(axiosResp.status).json({ ok:false, error:'Erro FedEx Rates', upstream: axiosResp.data });
                // }
                // const rateResp = axiosResp.data;
                // breakdown = extractFedexBreakdown(rateResp, rate_payload?.requestedShipment?.serviceType);

                // Se o front já envia o response do Rate: (recomendado)
                const rateResp = rate_payload;
                breakdown = extractFedexBreakdown(rateResp, rate_payload?.requestedShipment?.serviceType);
                // BASE preferida = breakdown.base
                precoBase = Number.isFinite(breakdown?.base) ? Number(breakdown.base) : toNumSafe(precoBase);
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

        // ===== Consolida valores FedEx =====
        const fdxBase = Number.isFinite(breakdown?.base) ? Number(breakdown.base) : (toNumSafe(precoBase) ?? 0);
        const fdxTotal = Number.isFinite(breakdown?.total)
            ? Number(breakdown.total)
            : (
                (Number.isFinite(breakdown?.base) ? Number(breakdown.base) : 0) +
                (Number.isFinite(breakdown?.serviceOptions) ? Number(breakdown.serviceOptions) : 0) +
                (Array.isArray(breakdown?.itemized) ? breakdown.itemized.reduce((a, b) => a + (toNumSafe(b.value) || 0), 0) : 0)
            );

        const fdxTaxesTotal = Math.max(0, fdxTotal - fdxBase);

        // ===== Aplicar plano sobre a BASE =====
        const pricingBase = aplicarPlanoSafely(fdxBase, plano);
        const precoFinalCliente = (toNumSafe(pricingBase?.preco_final) ?? fdxBase) + fdxTaxesTotal;

        // ===== Monta surcharges (idêntico UPS) =====
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
            (fdxBase + svc + items.reduce((a, b) => a + (b.value || 0), 0));

        const hasRealItemized = items.length > 0;
        const consolidatedItems = [...items];
        if (!hasRealItemized) {
            const diff = Math.max(0, totalCalc - fdxBase - svc);
            if (diff > 0.009) {
                consolidatedItems.unshift({
                    code: 'FDX-SUR',
                    label: 'FedEx surcharges (consolidado)',
                    value: diff,
                });
            }
        }

        const savedSurcharges = {
            currency: currency || 'USD',
            base: Number.isFinite(breakdown?.base) ? Number(breakdown.base) : fdxBase,
            serviceOptions: svc,
            itemized: consolidatedItems,
            total: totalCalc,
        };

        const carrierRawToSave = rate_payload || null;

        pedidoJson.pricing = {
            plano_aplicado: pricingBase.plano_aplicado,
            preco_base: fdxBase + (pricingBase?.ajuste || 0),    // BASE com ajuste do plano
            preco_final: precoFinalCliente,                      // BASE ajustada + TAXAS
            carrier: carrier ?? 'FEDEX',
            fonte_base: (overrideUsado ? 'OVERRIDE' : 'FEDEX'),
            currency,
            surcharges: savedSurcharges,
            carrier_total: fdxTotal,
            fedex_taxes_total: fdxTaxesTotal,
            carrier_raw: carrierRawToSave,
        };

        // ===== Persistência =====
        const registro = await Cotacao.create({
            cliente_id,
            pedido_ref,
            debug: {
                cliente_id,
                plano_reportado: plano,
                preco_base_usado: fdxBase
            },
            plano_aplicado: pricingBase.plano_aplicado,
            preco_base: fdxBase,                 // guarda BASE pura no topo (compat UPS)
            preco_final: precoFinalCliente,
            pais_remetente: pais_remetente ?? null,
            pais_dest: pais_dest ?? null,
            pedido: pedidoJson,
            surcharges: pedidoJson?.pricing?.surcharges || null,
            caixa: (caixa && typeof caixa === 'object') ? caixa : {},
            tracking_number: tracking_number ?? null,
            carrier: carrier ?? 'FEDEX',
            status_norm: 'CRIADO',               // respeita enum
            last_tracking_at: null,
        }, { transaction: t });

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
        console.error('[FEDEX createCotacaoReal][ERROR]', err?.message, err?.stack);
        return res.status(500).json({ ok: false, error: 'Erro ao criar cotação FedEx' });
    }
}

// ===== SHIP (emissão) =====
// Mantém status_norm "CRIADO" para não violar o enum (seu refresh de tracking atualiza depois).
function get(obj, path, def = undefined) {
    try {
        return String(path)
            .split('.')
            .reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj) ?? def;
    } catch {
        return def;
    }
}

// forçar array
const toArr = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// pega campos comuns de docs (url/base64)
function collectDocUrls(docList) {
    const arr = toArr(docList);
    return arr
        .map((d) => d && (d.url || d.contentUrl || d.href))
        .filter(Boolean);
}

async function shipFedex(req, res) {
    try {
        const cliente_id = Number(req.body?.cliente_id ?? req.clienteId);
        if (!cliente_id) {
            return res.status(401).json({ ok: false, error: 'Cliente não autenticado' });
        }

        const pedido_ref = normRef(req.body?.pedido_ref);
        const ship_payload = req.body?.ship_payload;
        if (!pedido_ref || !ship_payload) {
            return res
                .status(400)
                .json({ ok: false, error: 'pedido_ref e ship_payload são obrigatórios' });
        }

        // precisa existir a cotação
        const cotacao = await Cotacao.findOne({ where: { cliente_id, pedido_ref } });
        if (!cotacao) {
            return res
                .status(404)
                .json({ ok: false, error: 'Cotação não encontrada para este pedido' });
        }

        // Token + chamada Ship
        const token = await getFedexToken();
        const shipAxios = await axios.post(fedexCfg.ship, ship_payload, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            timeout: fedexCfg.timeoutMs,
            validateStatus: () => true,
        });

        // Trata erros HTTP
        if (shipAxios.status >= 400) {
            const d = shipAxios.data || {};
            const errors = Array.isArray(d.errors) ? d.errors : [];
            const detail = {
                transactionId: d.transactionId,
                errors: errors.map((e) => ({
                    code: e.code,
                    message: e.message,
                    parameterList: e.parameterList || e.parameters || e.messageParameters || null,
                })),
            };

            console.log('[FEDEX SHIP][REQUEST]', JSON.stringify(ship_payload, null, 2));
            console.log('[FEDEX SHIP][ERROR RAW]', JSON.stringify(d, null, 2));

            return res.status(shipAxios.status).json({
                ok: false,
                error: 'Erro FedEx Ship',
                upstream_status: shipAxios.status,
                upstream: detail,
                request_echo: ship_payload,
            });
        }

        // === SUCESSO ===
        const shipResp = shipAxios.data || {};

        // A FedEx costuma retornar em output.transactionShipments
        const txShipments = get(shipResp, 'output.transactionShipments', []);
        const firstTx = txShipments[0] || {};

        // tracking (às vezes vem em masterTrackingNumber, às vezes em pieceResponses[i].trackingNumber)
        const masterTracking = get(firstTx, 'masterTrackingNumber', null);
        const pieceResponses = get(firstTx, 'pieceResponses', []);
        const firstPiece = pieceResponses[0] || {};
        const trackingNumber = masterTracking || get(firstPiece, 'trackingNumber', null);

        // documentos podem aparecer em vários lugares
        const packageDocs1 = get(firstPiece, 'packageDocuments', []);
        const packageDocs2 = get(firstTx, 'packageDocuments', []);
        const shipmentDocs = get(firstTx, 'shipmentDocuments', []); // alguns ambientes usam este

        const allDocs = []
            .concat(toArr(packageDocs1))
            .concat(toArr(packageDocs2))
            .concat(toArr(shipmentDocs));

        const labelUrls = collectDocUrls(allDocs);

        // Atualiza pedido na cotação
        const pedidoOld = cotacao.pedido || {};
        const pedidoNew = { ...pedidoOld, ship_request: ship_payload, ship_response: shipResp };

        await cotacao.update({
            pedido: pedidoNew,
            tracking_number: trackingNumber || cotacao.tracking_number || null,
            carrier: 'FEDEX',
            // status_norm: 'CRIADO' — deixe o cron/endpoint de tracking mover estado com segurança
        });

        return res.status(200).json({
            ok: true,
            updated: true,
            cotacao_id: cotacao.id,
            pedido_ref,
            tracking_number: trackingNumber,
            labels: labelUrls,
            raw: {
                transactionId: shipResp.transactionId || null,
            },
        });
    } catch (err) {
        const ax = err || {};
        const net = ax.isAxiosError ? {
            code: ax.code,
            errno: ax.errno,
            syscall: ax.syscall,
            message: ax.message,
        } : null;

        console.error('[FEDEX shipFedex][FATAL]', err?.stack || err?.message || err, {
            net,
            shipUrl: require('../config/fedex').ship
        });

        return res.status(500).json({
            ok: false,
            error: 'Erro ao emitir envio FedEx',
            detail: err?.message || null,
            net,
            shipUrl: require('../config/fedex').ship
        });
    }
}

module.exports = {
    createCotacaoRealFedex,
    shipFedex,
};
