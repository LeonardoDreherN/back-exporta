// Normaliza a resposta da UPS Rate API para o formato padronizado de quotes
module.exports = function normUps(upsResp) {
    const rs = upsResp?.raw?.RateResponse?.RatedShipment || upsResp?.RatedShipment || [];
    const arr = Array.isArray(rs) ? rs : [rs].filter(Boolean);

    return arr.map((r) => {
        const svcCode = r?.Service?.Code || '';
        const serviceLabel =
            r?.Service?.Description ||
            ({ '07': 'Worldwide Express', '08': 'Worldwide Expedited', '65': 'Saver' }[svcCode] || 'UPS Service');

        // prioriza negotiated quando existir
        const nrc = r?.NegotiatedRateCharges;
        const total = +(nrc?.TotalCharge?.MonetaryValue || r?.TotalCharges?.MonetaryValue || 0);
        const currency = nrc?.TotalCharge?.CurrencyCode || r?.TotalCharges?.CurrencyCode || 'USD';
        const base = +(nrc?.BaseServiceCharge?.MonetaryValue || r?.BaseServiceCharge?.MonetaryValue || 0);

        const itemized = []
            .concat(nrc?.ItemizedCharges || r?.ItemizedCharges || [])
            .map(it => ({
                code: String(it?.Code || ''),
                label: it?.Description || it?.Code || 'Surcharge',
                value: +it?.MonetaryValue || 0
            }));

        // ETA simples (pode melhorar com TimeInTransit futuramente)
        const eta = null;

        return {
            carrier: 'UPS',
            serviceCode: svcCode,
            serviceLabel,
            currency,
            total,
            base,
            itemized,
            eta,
            raw: r
        };
    });
};
