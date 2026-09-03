// services/ups/rating.js
const { createHttp } = require('../../utils/https');
const { getToken } = require('./oauth');
const cfg = require('../../config/ups');

const http = createHttp(cfg.timeoutMs, 'ups');

function extractUpsMessage(err) {
    const data = err?.response?.data;
    if (!data) return null;

    return (
        data?.response?.errors?.[0]?.message ||
        data?.response?.errors?.[0]?.code ||
        data?.Fault?.detail?.Errors?.ErrorDetail?.PrimaryErrorCode?.Description ||
        data?.Fault?.detail ||
        data?.error_description ||
        data?.error ||
        null
    );
}

async function requestRating(url, payload, creds = {}) {
    try {
        const token = await getToken(false, creds);

        const res = await http.post(
            url,
            payload,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    transactionSrc: 'back-exporta',
                },
                timeout: cfg.timeoutMs || 30000,
            }
        );

        return res.data;
    } catch (err) {
        const status = err?.response?.status || 500;
        const data = err?.response?.data;
        const headers = err?.response?.headers;

        console.error('UPS RATE error =>', {
            url,
            status,
            correlation:
                headers?.['transId'] ||
                headers?.['x-correlation-id'] ||
                headers?.['x-transaction-id'] ||
                null,
            data,
        });

        const e = new Error(extractUpsMessage(err) || `UPS Rate failed with status ${status}`);
        e.status = status;
        e.details = data;
        throw e;
    }
}

// Cota um Service.Code especifico (o payload precisa trazer Shipment.Service).
async function quote(payload, creds = {}) {
    return requestRating(cfg.rate, payload, creds);
}

// Cota todos os servicos que a UPS oferece na rota. O payload NAO deve trazer
// Shipment.Service — a resposta vem com um RatedShipment por servico disponivel.
async function quoteShop(payload, creds = {}) {
    return requestRating(cfg.shop, payload, creds);
}

module.exports = { quote, quoteShop };
