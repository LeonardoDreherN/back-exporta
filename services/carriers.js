// @ts-check
// services/carriers.js
// Adapter genérico de carrier (hoje UPS). Futuro: FedEx, Correios...
const rating = require('./ups/rating'); // precisa expor rating.quote(payload)
const ratingFedex = require('./fedex/ratingFedex')

/**
 * @typedef {'UPS' | 'FEDEX'} CarrierCode
 */

/**
 * @typedef {Object} CotarCarrierArgs
 * @property {CarrierCode | string} [carrier]
 * @property {any} [payload]
 * @property {any} [rate_payload]
 * @property {any} [upsPayload]
 */

/**
 * @typedef {Object} CotarCarrierResult
 * @property {number} precoBase
 * @property {number | null} negotiated
 * @property {number | null} published
 * @property {number} amount
 * @property {CarrierCode | string} carrier
 * @property {string} [currency]
 * @property {any} [breakdown]
 * @property {any} raw
 */

/**
 * Cotação genérica de frete via carrier (UPS ou FedEx).
 * @param {CotarCarrierArgs} [args]
 * @returns {Promise<CotarCarrierResult>}
 */
async function cotarCarrier(args = {}) {
    const carrier = String(args.carrier || 'UPS').toUpperCase()
    // Stub para dev
    if (String(process.env.UPS_STUB || '') === 'true') {
        const preco = 42.0;
        return {
            precoBase: preco,
            negotiated: preco,
            published: preco,
            amount: preco,
            carrier,
            raw: { stub: true }
        };
    }

    const payload = args.payload || args.rate_payload || args.upsPayload;
    if (!payload) {
        const err = new Error('cotarCarrier requer payload de rate (args.payload)');
        err.code = 'NO_RATE_PAYLOAD';
        throw err;
    }

    /** @type {any} */
    let resp;
    try {
        if (carrier === "FEDEX") {
            resp = await ratingFedex.quoteRates(payload);
        } else {
            resp = await rating.quote(payload);
        }
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

    /** @type {number | null} */
    let negotiated = null;
    /** @type {number | null} */
    let published = null;
    /** @type {number} */
    let amount = NaN;

    if (carrier === "UPS") {
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

        negotiated = Number(negCharge);
        published = Number(pubCharge);
        amount = Number.isFinite(negotiated)
            ? negotiated
            : (Number.isFinite(published) ? published : NaN);

        if (!Number.isFinite(amount)) {
            const err = new Error('Carrier não retornou preço (negotiated/published ausentes)');
            err.upstream = resp;
            throw err;
        }
    } else {
        if (carrier === "FEDEX") {
            // ratingFedex.quoteRates(payload) retorna { rows, raw }
            const rows = resp?.rows || [];
            const pick = rows.find(/** @type {(r: any) => boolean} */((r) => r.serviceType === 'FEDEX_INTERNATIONAL_CONNECT_PLUS')) || rows[0];

            if (!pick || !Number.isFinite(pick.total)) {
                const err = new Error('FedEx não retornou total válido');
                err.upstream = resp;
                throw err;
            }

            negotiated = pick.total; // pra manter compat
            published = pick.total;
            amount = pick.total;

            return {
                precoBase: amount,
                negotiated,
                published,
                amount,
                carrier,
                currency: 'USD',
                breakdown: {
                    freight: pick.base,
                    surcharges: pick.itemized,
                    total: pick.total,
                    fx_used: pick.fx_used || null,
                    carrier_currency: pick.carrier_currency || null,
                },
                raw: resp,
            };
        }
    }

    return {
        precoBase: amount,   // valor total negociado/publicado (mantido por compat)
        negotiated: Number.isFinite(negotiated) ? negotiated : null,
        published: Number.isFinite(published) ? published : null,
        amount,
        carrier,
        raw: resp,           // mantenha bruto para o controller extrair os detalhes
    };
}

module.exports = { cotarCarrier };
