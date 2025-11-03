// utils/upsBreakdown.js
function n(v) {
    const x = Number(typeof v === 'string' ? v.replace(',', '.') : v);
    return Number.isFinite(x) ? x : 0;
}
const toArr = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// pick tolerante a PascalCase/camelCase
function pick(o, keys = []) {
    if (!o || typeof o !== 'object') return undefined;
    for (const k of keys) if (o[k] !== undefined) return o[k];
    return undefined;
}

// normaliza itemized (remove zeros)
function normalizeItemized(itemized) {
    return toArr(itemized)
        .map((it) => ({
            code: String(pick(it, ['Code', 'code']) || '').toUpperCase(),
            label:
                pick(it, ['Description', 'description']) ||
                pick(it, ['Code', 'code']) ||
                'Surcharge',
            value: n(pick(it, ['MonetaryValue', 'monetaryValue'])),
            currency: pick(it, ['CurrencyCode', 'currencyCode']),
        }))
        .filter((x) => x.value > 0);
}

// acha primeiro RatedShipment em qualquer nível
function findFirstRatedShipment(node) {
    if (!node || typeof node !== 'object') return null;

    const rsDirect = pick(node, ['RatedShipment', 'ratedShipment']);
    if (rsDirect) return Array.isArray(rsDirect) ? rsDirect[0] : rsDirect;

    const inner = pick(node, ['RateResponse', 'rateResponse']);
    if (inner) {
        const rs = pick(inner, ['RatedShipment', 'ratedShipment']);
        if (rs) return Array.isArray(rs) ? rs[0] : rs;
    }

    for (const k of Object.keys(node)) {
        const v = node[k];
        if (v && typeof v === 'object') {
            const hit = findFirstRatedShipment(v);
            if (hit) return hit;
        }
    }
    return null;
}

function extractUpsBreakdown(raw) {
    if (!raw) return null;

    // aceita: objeto inteiro, .RateResponse, .rateResponse, .raw, etc.
    const candidate =
        raw?.RateResponse || raw?.rateResponse || raw?.raw || raw;
    const rs = findFirstRatedShipment(candidate);
    if (!rs) return null;

    // negotiated block (3 fontes possíveis)
    const neg =
        pick(rs, ['NegotiatedRateCharges', 'negotiatedRateCharges']) ||
        // alguns retornos colocam dentro do RatedPackage[0]
        pick(rs?.RatedPackage?.[0], ['NegotiatedCharges', 'negotiatedCharges']) ||
        null;

    // leitores tolerantes
    const money = (o) => n(pick(o || {}, ['MonetaryValue', 'monetaryValue']));
    const ccode = (o) => pick(o || {}, ['CurrencyCode', 'currencyCode']);

    // published
    const rsBase = money(pick(rs, ['BaseServiceCharge', 'baseServiceCharge']));
    const rsTransp = money(pick(rs, ['TransportationCharges', 'transportationCharges']));
    const rsSvc = money(pick(rs, ['ServiceOptionsCharges', 'serviceOptionsCharges']));
    const rsTotal = money(pick(rs, ['TotalCharges', 'totalCharges'])) ||
        money(pick(rs, ['RatedShipmentTotalCharges', 'ratedShipmentTotalCharges']));

    // negotiated
    const negBase = money(pick(neg, ['BaseServiceCharge', 'baseServiceCharge']));
    const negTransp = money(pick(neg, ['TransportationCharges', 'transportationCharges']));
    const negSvc = money(pick(neg, ['ServiceOptionsCharges', 'serviceOptionsCharges']));
    const negTotal = money(pick(neg, ['TotalCharge', 'totalCharge']));

    // currency (prioriza negotiated > total > transp)
    const currency =
        ccode(pick(neg, ['TotalCharge', 'totalCharge'])) ||
        ccode(pick(rs, ['TotalCharges', 'totalCharges'])) ||
        ccode(pick(rs, ['TransportationCharges', 'transportationCharges'])) ||
        'USD';

    // base prioriza BaseServiceCharge negociado -> Base publicada -> Transportation
    const base =
        negBase || rsBase || negTransp || rsTransp || 0;

    const serviceOptions = negSvc || rsSvc || 0;

    // soma itemized negotiated + published e dedup por código
    const allItemized = [
        ...normalizeItemized(pick(neg, ['ItemizedCharges', 'itemizedCharges'])),
        ...normalizeItemized(pick(rs, ['ItemizedCharges', 'itemizedCharges'])),
    ];
    const itemized = Object.values(
        allItemized.reduce((acc, it) => {
            if (it.value <= 0) return acc;
            acc[it.code] = { ...it, currency: it.currency || currency };
            return acc;
        }, {})
    );

    const computedSum =
        (Number.isFinite(base) ? base : 0) +
        (Number.isFinite(serviceOptions) ? serviceOptions : 0) +
        itemized.reduce((a, b) => a + (b.value || 0), 0);

    // total prioriza negotiated > published > soma
    const total = negTotal || rsTotal || computedSum;

    return { base, total, currency, itemized, serviceOptions };
}

module.exports = { extractUpsBreakdown };
