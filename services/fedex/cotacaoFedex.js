// backend/services/fedex/cotacaoFedex.js
const { toNumSafe, up } = require('../cotacoesHelpers');

/**
 * Espera receber rate_payload no formato bruto da FedEx
 * (output de /rate/v1/rates/quotes, ou o pedaço escolhido).
 */
function extractFedexBreakdown(rateRaw) {
    if (!rateRaw) return null;

    // se vier { raw, rows } (ex.: retorno do quoteRates)
    if (rateRaw.raw && rateRaw.rows) {
        // pega a primeira linha por padrão
        const firstRow = rateRaw.rows[0];
        if (!firstRow) return null;
        return {
            serviceType: firstRow.serviceType,
            currency: firstRow.currency || 'USD',
            base: firstRow.base,
            total: firstRow.base, // se você ainda não separar base/total, deixa igual
            itemized: (firstRow.itemized || []).map(it => ({
                code: up(it.code || ''),
                label: it.code || it.label || 'Surcharge',
                value: Number(it.amount || 0) || 0,
            })),
        };
    }

    // caso seja o JSON bruto da FedEx:
    const details =
        rateRaw?.output?.rateReplyDetails ||
        rateRaw?.rateReplyDetails ||
        [];

    const svc = Array.isArray(details) ? details[0] : details;
    if (!svc) return null;

    const rated =
        svc?.ratedShipmentDetails?.[0] ||
        svc?.ratedShipmentDetails ||
        svc?.ratedShipmentDetail ||
        {};

    const totalNet =
        rated?.totalNetCharge?.amount ??
        rated?.shipmentRateDetail?.totalNetCharge?.amount ??
        rated?.totalBaseCharge?.amount ??
        null;

    const baseCharge =
        rated?.shipmentRateDetail?.totalBaseCharge?.amount ??
        rated?.totalBaseCharge?.amount ??
        totalNet;

    const currency =
        rated?.totalNetCharge?.currency ||
        rated?.shipmentRateDetail?.totalNetCharge?.currency ||
        'USD';

    const surs = rated?.shipmentRateDetail?.surcharges || [];

    return {
        serviceType: svc.serviceType || svc.serviceName || '',
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

async function prepararCotacaoFedex({ rate_payload, preco_base, freightValueNum }) {
    let precoBase = null;
    let breakdown = null;

    const precoBaseOverride = toNumSafe(preco_base ?? freightValueNum);
    const overrideUsado = Number.isFinite(precoBaseOverride);

    if (!rate_payload && !overrideUsado) {
        const err = new Error(
            'Envie preco_base (ou freightValueNum) OU rate_payload para cotação FedEx.'
        );
        err.status = 400;
        throw err;
    }

    if (rate_payload) {
        breakdown = extractFedexBreakdown(rate_payload);
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
        serviceType: 'FEDEX_INTERNATIONAL_CONNECT_PLUS',
        base: fedexBase,
        total: totalCalc,
        taxesTotal: fedexTaxesTotal,
        currency,
        surcharges: savedSurcharges,
        carrier_raw: rate_payload || null,
        fonte_base: overrideUsado ? 'OVERRIDE' : 'FEDEX',
    };

}

module.exports = { prepararCotacaoFedex };
