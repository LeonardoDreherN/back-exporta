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

    // Preferimos receber o payload completo do endpoint de Rate da UPS:
    const payload = args.payload || args.rate_payload || args.upsPayload;
    if (!payload) {
        // Mantemos explícito para não gerar cotações inconsistentes
        const err = new Error('cotarCarrier requer payload de rate (args.payload)');
        err.code = 'NO_RATE_PAYLOAD';
        throw err;
    }

    let resp;
    try {
        resp = await rating.quote(payload);
    } catch (e) {
        // Propaga erro com máximo contexto
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

    const negotiated = Number(
        resp?.RatedShipment?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue ??
        resp?.rateResponse?.ratedShipment?.[0]?.negotiatedRateCharges?.totalCharge?.monetaryValue
    );

    const published = Number(
        resp?.RatedShipment?.TotalCharges?.MonetaryValue ??
        resp?.rateResponse?.ratedShipment?.[0]?.totalCharges?.monetaryValue
    );

    const amount = Number.isFinite(negotiated) ? negotiated :
        Number.isFinite(published) ? published : NaN;

    if (!Number.isFinite(amount)) {
        const err = new Error('Carrier não retornou preço (negotiated/published ausentes)');
        err.upstream = resp;
        throw err;
    }

    return {
        precoBase: amount,
        negotiated: Number.isFinite(negotiated) ? negotiated : null,
        published: Number.isFinite(published) ? published : null,
        amount,
        carrier: 'UPS',
        raw: resp,
    };
}

module.exports = { cotarCarrier };
