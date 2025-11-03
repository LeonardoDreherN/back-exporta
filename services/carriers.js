// services/carriers.js
// Adapter genérico de carrier (hoje UPS). Futuro: FedEx, Correios...
const rating = require('./ups/rating'); // precisa expor rating.quote(payload)

async function cotarCarrier(args = {}) {
    // Stub para dev
    if (String(process.env.UPS_STUB || '') === 'true') {
        const preco = 42.0;
        return {
            precoBase: preco,
            negotiated: preco,
            published: preco,
            amount: preco,
            carrier: 'UPS',
            raw: { stub: true }
        };
    }

    const payload = args.payload || args.rate_payload || args.upsPayload;
    if (!payload) {
        const err = new Error('cotarCarrier requer payload de rate (args.payload)');
        err.code = 'NO_RATE_PAYLOAD';
        throw err;
    }

    let resp;
    try {
        resp = await rating.quote(payload); // { RateResponse | rateResponse | ... }
    } catch (e) {
        const up = e?.response?.data || e?.upstream;
        const msg =
            up?.response?.errors?.[0]?.message ||
            up?.error_description ||
            up?.error ||
            e.message || 'Falha na cotação do carrier';
        const err = new Error(msg);
        err.response = e?.response;
        err.upstream = up || e;
        throw err;
    }

    // tenta ler negociado/publicado nos dois formatos
    const rs = (resp?.RateResponse || resp?.rateResponse || {}).RatedShipment ||
        (resp?.RateResponse || resp?.rateResponse || {}).ratedShipment ||
        null;
    const first = Array.isArray(rs) ? rs[0] : rs;

    const negCharge =
        first?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue ??
        first?.negotiatedRateCharges?.totalCharge?.monetaryValue;
    const pubCharge =
        first?.TotalCharges?.MonetaryValue ??
        first?.totalCharges?.monetaryValue;

    const negotiated = Number(negCharge);
    const published = Number(pubCharge);
    const amount = Number.isFinite(negotiated)
        ? negotiated
        : (Number.isFinite(published) ? published : NaN);

    if (!Number.isFinite(amount)) {
        const err = new Error('Carrier não retornou preço (negotiated/published ausentes)');
        err.upstream = resp;
        throw err;
    }

    return {
        precoBase: amount,   // valor total negociado/publicado (mantido por compat)
        negotiated: Number.isFinite(negotiated) ? negotiated : null,
        published: Number.isFinite(published) ? published : null,
        amount: amount,
        carrier: 'UPS',
        raw: resp,           // mantenha bruto para o controller extrair os detalhes
    };
}

module.exports = { cotarCarrier };
