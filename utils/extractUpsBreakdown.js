// utils/extractUpsBreakdown.js

function toNum(v) {
    if (v === null || v === undefined) return 0;
    const s = String(v).replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Extrai informações detalhadas do retorno da UPS:
 * - base (TransportationCharges)
 * - total (TotalCharges ou NegotiatedRateCharges.TotalCharge)
 * - currency
 * - serviceOptions (ServiceOptionsCharges)
 * - itemized[] (lista de taxas, incluindo combustível, remoto, etc.)
 */
function extractUpsBreakdown(raw) {
    if (!raw) return null;

    // Encontra RatedShipment em diferentes formatos de payload
    const rated =
        raw?.RateResponse?.RatedShipment?.[0] ||
        raw?.RatedShipment?.[0] ||
        raw?.ShipmentRating?.RatedShipment?.[0] ||
        raw;

    if (!rated) return null;

    // Preferir negotiated quando disponível
    const negotiated = rated?.NegotiatedRateCharges || rated?.NegotiatedRates || null;

    const totalBlock =
        (negotiated && (negotiated.TotalCharge || negotiated.TotalCharges)) ||
        rated?.TotalCharges ||
        rated?.TotalCharge ||
        {};

    const baseBlock =
        rated?.TransportationCharges ||
        rated?.BaseServiceCharge ||
        {};

    const svcBlock =
        rated?.ServiceOptionsCharges ||
        (negotiated && negotiated.ServiceOptionsCharges) ||
        {};

    const currency =
        totalBlock?.CurrencyCode ||
        baseBlock?.CurrencyCode ||
        svcBlock?.CurrencyCode ||
        rated?.CurrencyCode ||
        'USD';

    const base = toNum(baseBlock?.MonetaryValue);
    const total = toNum(totalBlock?.MonetaryValue);
    const serviceOptions = toNum(svcBlock?.MonetaryValue);

    // Itemizados (Negotiated > Standard)
    const rawItems =
        (negotiated && negotiated.ItemizedCharges) ||
        rated?.ItemizedCharges ||
        (rated?.ServiceOptionsCharges && rated.ServiceOptionsCharges.ItemizedCharges) ||
        [];

    const itemized = (Array.isArray(rawItems) ? rawItems : [])
        .map((i) => {
            const code = String(i?.Code ?? '').trim();
            const desc = String(i?.Description ?? '').trim();
            const val = toNum(i?.MonetaryValue);
            return {
                code: code || (/(fuel|combust[ií]vel|fsc)/i.test(desc) ? 'FUEL' : undefined),
                label: desc || code || 'Surcharge',
                value: val,
            };
        })
        .filter((i) => i.value !== 0);

    // Se a base não veio, tenta inferir (total - serviceOptions - soma itemized)
    let normBase = base;
    if (normBase === 0 && total > 0) {
        const sumItems = itemized.reduce((a, b) => a + b.value, 0);
        const inferred = total - serviceOptions - sumItems;
        if (inferred > 0) normBase = inferred;
    }

    return {
        currency,
        base: normBase,
        serviceOptions,
        itemized,
        total,
    };
}

module.exports = { extractUpsBreakdown };
