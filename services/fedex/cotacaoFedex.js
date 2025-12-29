// backend/services/fedex/cotacaoFedex.js
const { toNumSafe, up } = require('../cotacoesHelpers');

/**
 * Espera receber rate_payload no formato bruto da FedEx
 * (output de /rate/v1/rates/quotes, ou o pedaço escolhido).
 */
function extractFedexBreakdown(rateRaw, preferredServiceType) {
    if (!rateRaw) return null;

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
            serviceType: firstRow.serviceType || preferredServiceType || "FEDEX_INTERNATIONAL_CONNECT_PLUS",
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
    console.log('extractFedexBreakdown svc=', svc);
    if (!svc) return null;

    const rated =
        svc?.ratedShipmentDetails?.[0] ||
        svc?.ratedShipmentDetails ||
        svc?.ratedShipmentDetail ||
        {};

    const toNum = (v) => {
        const n = Number(v?.amount ?? v);
        return Number.isFinite(n) ? n : null;
    };

    const totalNet =
        toNum(rated?.totalNetCharge) ??
        toNum(rated?.shipmentRateDetail?.totalNetCharge) ??
        toNum(rated?.totalNetFedExCharge) ??
        toNum(rated?.totalNetChargeWithDutiesAndTaxes) ??
        null;

    const totalBase =
        toNum(rated?.totalBaseCharge) ??
        null;

    const totalDiscounts = toNum(rated?.totalDiscounts) ?? 0;
    const baseCharge = Number.isFinite(totalBase) ? Math.max(0, totalNet - totalDiscounts) : totalNet;

    const currency =
        rated?.shipmentRateDetail?.currency ||
        rated?.totalNetCharge?.currency ||
        rated?.shipmentRateDetail?.totalNetCharge?.currency ||
        'USD';

    const surs =
        rated?.shipmentRateDetail?.surcharges ||
        rated?.shipmentRateDetail?.surCharges ||
        [];

    return {
        serviceType: preferredServiceType || svc.serviceType || svc.serviceName || '',
        currency,
        base: Number(baseCharge) || 0,
        total: Number(totalNet) || Number(baseCharge) || 0,
        itemized: surs.map(s => ({
            code: up(s?.surchargeType || s?.description || ''),
            label: s?.description || s?.surchargeType || 'Surcharge',
            value: Number(s?.amount?.amount ?? s?.amount ?? 0) || 0,
        })),
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
        breakdown = extractFedexBreakdown(ratePayloadRaw, preferredServiceType);
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
        fedexBase; // se não tiver total separado, usa base

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
        base: fedexBase,
        total: totalCalc,
        taxesTotal: fedexTaxesTotal,
        currency,
        surcharges: savedSurcharges,
        carrier_raw,
        fonte_base: overrideUsado ? 'OVERRIDE' : 'FEDEX',
    };

}

module.exports = { prepararCotacaoFedex };
