// backend/services/fedex/cotacaoFedex.js
const { valorConversao } = require('../../utils/dolar');
const { toNumSafe, up } = require('../cotacoesHelpers');

/**
 * Espera receber rate_payload no formato bruto da FedEx
 * (output de /rate/v1/rates/quotes, ou o pedaço escolhido).
 */
async function extractFedexBreakdown(rateRaw, preferredServiceType) {
    if (!rateRaw) return null;

    //     hasRaw: !!rateRaw?.raw,
    //     hasRows: !!rateRaw?.rows,
    //     raw: rateRaw?.raw,
    //     rows: rateRaw?.rows,
    // });

    // se vier { raw, rows } (ex.: retorno do quoteRates)
    if (rateRaw.raw && rateRaw.rows) {
        const firstRow = preferredServiceType
            ? rateRaw.rows.find(r => r?.serviceType === preferredServiceType) || rateRaw.rows[0]
            : rateRaw.rows[0];
        if (!firstRow) return null;

        const base = Number(firstRow.base ?? firstRow.freight ?? 0) || 0;
        const total = Number(firstRow.total ?? 0) || base;
        const sur =
            Number(firstRow.surcharges ?? firstRow.sur ?? 0) ||
            Math.max(0, total - base);
        const itemized = Array.isArray(firstRow.itemized) ? firstRow.itemized : [];

        return {
            serviceType: firstRow.serviceType || preferredServiceType,
            currency: firstRow.currency || "USD",
            base,
            total,
            itemized: itemized.length
                ? itemized.map(it => ({
                    code: up(it?.code || ""),
                    label: it?.label || it?.code || "Surcharge",
                    value: Number(it?.value ?? it?.amount ?? 0) || 0,
                }))
                : (sur > 0 ? [{ code: "FEDEX-SUR", label: "FedEx surcharges (consolidado)", value: sur }] : []),
        };
    }

    // caso seja o JSON bruto da FedEx:
    const details =
        rateRaw?.output?.rateReplyDetails ||
        rateRaw?.rateReplyDetails ||
        [];

    const svc = Array.isArray(details)
        ? (preferredServiceType
            ? details.find(d => d?.serviceType === preferredServiceType) || details[0]
            : details[0])
        : details;
    if (!svc) return null;

    const rated =
        svc?.ratedShipmentDetails?.[0] ||
        svc?.ratedShipmentDetails ||
        svc?.ratedShipmentDetail ||
        {};


    const toNum = (v) => {
        const n = Number(v?.amount ?? v?.value ?? v);
        return Number.isFinite(n) ? n : null;
    };
    const pickSurchargeAmount = (s) =>
        toNum(
            s?.amount?.amount ??
            s?.amount ??
            s?.surchargeAmount ??
            s?.netCharge ??
            s?.chargeAmount ??
            s?.value
        );
    const mapSurcharge = (s, fxRate) => {
        const raw = pickSurchargeAmount(s);
        const val = Number.isFinite(raw) ? raw / fxRate : 0;
        if (!(val > 0)) return null;
        const code = up(s?.surchargeType || s?.type || s?.code || s?.description || '');
        const label = s?.description || s?.surchargeDescription || s?.surchargeType || s?.type || 'Surcharge';
        return { code, label, value: Number(val) || 0 };
    };

    const totalNet =
        toNum(rated?.totalNetCharge) ?? null;

    const totalSurcharges = toNum(rated?.shipmentRateDetail?.totalSurcharges) ?? 0;

    // const totalBase =
    //     toNum(rated?.totalBaseCharge) ??
    //     null;

    const baseCharge = totalNet - totalSurcharges;

    const currency = 'USD';

    const ratedPkg = rated?.ratedPackages?.[0]?.packageRateDetail || {};
    const surs =
        rated?.shipmentRateDetail?.surcharges ||
        rated?.shipmentRateDetail?.surCharges ||
        ratedPkg?.surcharges ||
        ratedPkg?.surCharges ||
        [];
    const conversaoRaw = await valorConversao();
    const conversao = (toNumSafe(conversaoRaw) || 0);
    const fx = Number.isFinite(conversao) && conversao > 0 ? conversao : 1;
    const base = baseCharge / fx;
    const total = totalNet / fx

    const itemized = Array.isArray(surs)
        ? surs.map((s) => mapSurcharge(s, fx)).filter(Boolean)
        : [];

    return {
        serviceType: preferredServiceType || svc.serviceType || svc.serviceName || '',
        currency,
        base,
        total,
        itemized,
    };
}

function isFedexRateRaw(obj) {
    if (!obj || typeof obj !== 'object') return false;
    return !!(obj.output?.rateReplyDetails || obj.RateReplyDetails || obj.transactionId);
}

async function prepararCotacaoFedex({ req, rate_payload, preco_base, freightValueNum, plano }) {
    let precoBase = null;
    let breakdown = null;
    let carrier_raw = null;

    const precoBaseOverride = toNumSafe(preco_base ?? freightValueNum);
    // comentario informal: 0 nao vale como override, senao zera tudo
    const overrideUsado = Number.isFinite(precoBaseOverride) && precoBaseOverride > 0;

    if (!rate_payload && !overrideUsado) {
        const err = new Error(
            'Envie preco_base (ou freightValueNum) OU rate_payload para cotação FedEx.'
        );
        err.status = 400;
        throw err;
    }

    const rawFromWrapper = rate_payload?.raw;
    const ratePayloadRaw = isFedexRateRaw(rawFromWrapper)
        ? rawFromWrapper
        : (isFedexRateRaw(rate_payload) ? rate_payload : null);

    const preferredServiceType = 'FEDEX_INTERNATIONAL_CONNECT_PLUS';

    if (ratePayloadRaw) {
        carrier_raw = ratePayloadRaw;
        breakdown = await extractFedexBreakdown(ratePayloadRaw, preferredServiceType);
    } else if (rate_payload) {
        // comentario informal: se vier estranho, pelo menos guarda o raw pra debugar
        carrier_raw = rate_payload;
        breakdown = null;
    } else {
        breakdown = null;
    }

    if (overrideUsado) {
        precoBase = precoBaseOverride;
    } else {
        const baseFromBreakdown =
            breakdown && Number.isFinite(Number(breakdown.base))
                ? Number(breakdown.base)
                : null;
        precoBase = baseFromBreakdown ?? 0;
    }

    if (!Number.isFinite(precoBase)) {
        const err = new Error('FedEx não retornou preço base');
        err.status = 400;
        throw err;
    }
    const fedexBase = precoBase;
    const fedexTotal =
        toNumSafe(breakdown?.total) ??
        fedexBase; // se nao tiver total separado, usa base

    const fedexTaxesTotal = Math.max(0, fedexTotal - fedexBase);
    const currency = breakdown?.currency || 'USD';

    const items = Array.isArray(breakdown?.itemized)
        ? breakdown.itemized.map(it => ({
            code: up(it.code ?? ''),
            label: it.label ?? it.code ?? 'Surcharge',
            value: Number(it.value ?? it.amount ?? 0) || 0,
        }))
        : [];

    const itemsSum = items.reduce((a, b) => a + (b.value || 0), 0);

    let totalCalc = toNumSafe(breakdown?.total);
    if (!Number.isFinite(totalCalc) || totalCalc <= 0) {
        totalCalc = fedexBase + itemsSum;
    }

    const savedSurcharges = {
        currency,
        base: fedexBase,
        serviceOptions: 0,
        itemized: items,
        total: totalCalc,
    };

    return {
        carrier: 'FEDEX',
        serviceCode: 'FEDEX_INTERNATIONAL_CONNECT_PLUS',
        base: breakdown.base,
        total: breakdown.total,
        taxesTotal: fedexTaxesTotal,
        currency,
        surcharges: savedSurcharges,
        carrier_raw,
        fonte_base: overrideUsado ? 'OVERRIDE' : 'FEDEX',
    };

}

// ===== Agendamento de coleta FedEx vinculado a uma cotação específica =====
const { Cotacao, Cliente, sequelize } = require('../../models');
const { iso2Country, normalizeTimeToHHMM } = require('../cotacoesHelpers');
const { createPickup } = require('./pickupFedex');
const fedexCfg = require('../../config/fedex');

function getItensTotalKgFromCotacao(cotacao) {
    const pedido = cotacao?.pedido || {};
    const manual = Number(pedido?.peso_total_kg);
    if (manual > 0) return manual;

    const itens = Array.isArray(pedido?.itens) ? pedido.itens : [];
    return itens.reduce((acc, it) => {
        const candidates = [
            it.peso_kg,
            it.weightKg,
            it.grams != null ? Number(it.grams) / 1000 : undefined,
            it.peso,
            it.pesoBruto,
        ];
        const unitKg =
            (candidates.map((v) => Number(v || 0)).find((v) => v > 0)) || 0;
        const qty = Number(it.qty || it.quantidade || 1) || 1;
        return acc + qty * unitKg;
    }, 0);
}

function toHHMMWithColon(hhmm) {
    return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
}

async function agendarPickupCotacaoFedex(req, res) {
    const t = await sequelize.transaction();
    try {
        const cotacaoId = Number(req.params.id || req.body.cotacaoId);
        if (!cotacaoId) {
            await t.rollback();
            return res.status(400).json({ ok: false, error: "cotacaoId inválido." });
        }

        const { pickupDate, readyTime, closeTime, readyDateTimestamp } = req.body || {};

        if (!pickupDate) {
            await t.rollback();
            return res.status(400).json({ ok: false, error: "pickupDate é obrigatório." });
        }
        if (!readyDateTimestamp) {
            await t.rollback();
            return res.status(400).json({ ok: false, error: "readyDateTimestamp é obrigatório." });
        }

        const cotacao = await Cotacao.findByPk(cotacaoId, { transaction: t });
        if (!cotacao) {
            await t.rollback();
            return res.status(404).json({ ok: false, error: "Cotação não encontrada." });
        }

        if (cotacao.carrier !== "FEDEX") {
            await t.rollback();
            return res.status(400).json({
                ok: false,
                error: "Agendamento de coleta disponível apenas para FedEx neste fluxo.",
            });
        }

        const cliente = await Cliente.findByPk(cotacao.cliente_id, { transaction: t });
        if (!cliente) {
            await t.rollback();
            return res.status(404).json({ ok: false, error: "Cliente da cotação não encontrado." });
        }

        const remetente = {
            nome: cliente.razaoSocial || cliente.nomeFantasia || "Remetente",
            telefone: cliente.telefoneCelular || cliente.telefone || "",
            rua: cliente.enderecoRua || "",
            numero: cliente.enderecoNumero || "",
            cidade: cliente.enderecoCidade || "",
            estado: cliente.enderecoEstado || "",
            cep: cliente.enderecoCEP || "",
            pais: iso2Country(cliente.enderecoPais || "BR"),
        };

        const okRemetente =
            remetente.nome && remetente.rua && remetente.cidade &&
            remetente.estado && remetente.cep && remetente.pais;

        if (!okRemetente) {
            await t.rollback();
            return res.status(400).json({
                ok: false,
                error: "Cadastro do remetente incompleto para agendar coleta.",
            });
        }

        const ready = normalizeTimeToHHMM(readyTime);
        const close = normalizeTimeToHHMM(closeTime);

        if (ready >= close) {
            await t.rollback();
            return res.status(400).json({
                ok: false,
                error: "O horário inicial deve ser menor que o horário final.",
            });
        }

        const totalKg = getItensTotalKgFromCotacao(cotacao);
        if (!totalKg || totalKg <= 0) {
            await t.rollback();
            return res.status(400).json({
                ok: false,
                error: "Peso total dos itens não encontrado para o pickup.",
            });
        }

        const streetLine = [remetente.rua, remetente.numero].filter(Boolean).join(", ");
        const closeHHMM = toHHMMWithColon(close);
        const readyHHMM = toHHMMWithColon(ready);

        const payload = {
            associatedAccountNumber: { value: fedexCfg.accountNumber || "" },
            originDetail: {
                pickupLocation: {
                    contact: {
                        personName: remetente.nome,
                        phoneNumber: remetente.telefone,
                    },
                    address: {
                        streetLines: [streetLine],
                        city: remetente.cidade,
                        stateOrProvinceCode: remetente.estado,
                        postalCode: remetente.cep,
                        countryCode: remetente.pais,
                    },
                },
                packageLocation: "FRONT",
                readyDateTimestamp,
                customerCloseTime: closeHHMM,
                pickupDateType: closeHHMM > readyHHMM ? "SAME_DAY" : "FUTURE_DAY",
            },
            totalPackageCount: 1,
            totalWeight: { units: "KG", value: totalKg },
            carrierCode: "FDXE",
        };

        const data = await createPickup(payload, {
            idempotencyKey: req.headers["x-idempotency-key"] || null,
        });

        await cotacao.update(
            {
                data_coleta: String(pickupDate).replace(/-/g, ""),
                ready_hora: ready,
                close_hora: close,
            },
            { transaction: t }
        );

        await t.commit();
        return res.json({ ok: true, cotacao_id: cotacao.id, pickup: data });
    } catch (err) {
        try {
            await t.rollback();
        } catch (e2) {
            console.error("[COTACAO][PICKUP][FEDEX][ROLLBACK_ERROR]", e2?.message);
        }

        console.error("[COTACAO][PICKUP][FEDEX][ERROR]", err?.message);

        return res.status(err.status || 500).json({
            ok: false,
            error: err.message || "Falha ao agendar pickup na FedEx.",
            raw: err.upstream || null,
        });
    }
}

module.exports = { prepararCotacaoFedex, extractFedexBreakdown, agendarPickupCotacaoFedex };




