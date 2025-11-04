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

    const candidate = raw?.RateResponse || raw?.rateResponse || raw?.raw || raw;
    const rs = typeof findFirstRatedShipment === 'function'
        ? findFirstRatedShipment(candidate)
        : (candidate?.RatedShipment?.[0] || candidate?.ratedShipment?.[0] || null);
    if (!rs) return null;

    // helpers
    const _num = (v) => (v == null ? 0 : Number.parseFloat(String(v)));
    const _pick = (obj, keys) => { if (!obj) return null; for (const k of keys) if (obj[k] != null) return obj[k]; return null; };
    const _money = (o) => _num(_pick(o || {}, ['MonetaryValue', 'monetaryValue', 'amount']));
    const _ccode = (o) => _pick(o || {}, ['CurrencyCode', 'currencyCode', 'currency']);
    const _normItemized = (arr, defaultCurrency) => {
        if (!Array.isArray(arr)) return [];
        return arr.map((x) => {
            const code = _pick(x, ['Code', 'code']);
            const val = _money(x);
            const cur = _ccode(x) || defaultCurrency || 'USD';
            if (!code || !Number.isFinite(val) || val <= 0) return null; // filtra zeros aqui
            return { code: String(code), value: val, currency: cur };
        }).filter(Boolean);
    };

    // negotiated
    const neg =
        _pick(rs, ['NegotiatedRateCharges', 'negotiatedRateCharges']) ||
        _pick(rs?.RatedPackage?.[0], ['NegotiatedCharges', 'negotiatedCharges']) ||
        null;

    const negBaseObj = _pick(neg, ['BaseServiceCharge', 'baseServiceCharge']);
    const negItemsArr = _pick(neg, ['ItemizedCharges', 'itemizedCharges']) || [];
    const negTotalObj = _pick(neg, ['TotalCharge', 'totalCharge']);

    const negBase = _money(negBaseObj);
    const negTotal = _money(negTotalObj);
    const negCurr = _ccode(negTotalObj) || _ccode(negBaseObj) || (negItemsArr[0] && _ccode(negItemsArr[0])) || 'USD';

    // published (fallback)
    const rsBase = _money(_pick(rs, ['BaseServiceCharge', 'baseServiceCharge']));
    const rsTrans = _money(_pick(rs, ['TransportationCharges', 'transportationCharges']));
    const rsSvc = _money(_pick(rs, ['ServiceOptionsCharges', 'serviceOptionsCharges']));
    const rsTotal = _money(_pick(rs, ['TotalCharges', 'totalCharges'])) ||
        _money(_pick(rs, ['RatedShipmentTotalCharges', 'ratedShipmentTotalCharges']));
    const pubCurr = _ccode(_pick(rs, ['TotalCharges', 'totalCharges'])) ||
        _ccode(_pick(rs, ['TransportationCharges', 'transportationCharges'])) ||
        'USD';
    const pubItemsArr = _pick(rs, ['ItemizedCharges', 'itemizedCharges']) || [];

    // currency: prioriza negotiated
    const currency = negCurr || pubCurr;

    // base: prioriza negotiated.BaseServiceCharge -> Base publicada -> Transportation publicada
    // const base =
    //     (Number.isFinite(negBase) && negBase > 0) ? negBase
    //         : (Number.isFinite(rsBase) && rsBase > 0) ? rsBase
    //             : (Number.isFinite(rsTrans) ? rsTrans : 0);

    const base = Number.isFinite(negBase) ? negBase
        : Number.isFinite(rsBase) ? rsBase
            : Number.isFinite(rsTrans) ? rsTrans
                : 0;

    // service options (só publicado)
    const serviceOptions = Number.isFinite(rsSvc) ? rsSvc : 0;

    // ITEMIZED: se houver negotiated, usa **somente** negotiated; senão, usa published
    const itemized = (neg ? _normItemized(negItemsArr, currency)
        : _normItemized(pubItemsArr, currency));

    // total: prioriza negotiated.TotalCharge -> published -> soma
    const computedSum =
        (Number.isFinite(base) ? base : 0) +
        (Number.isFinite(serviceOptions) ? serviceOptions : 0) +
        itemized.reduce((a, b) => a + (b.value || 0), 0);

    const total =
        (Number.isFinite(negTotal) && negTotal > 0) ? negTotal
            : (Number.isFinite(rsTotal) && rsTotal > 0) ? rsTotal
                : computedSum;

    return { base, total, currency, itemized, serviceOptions };
}

module.exports = { extractUpsBreakdown };
