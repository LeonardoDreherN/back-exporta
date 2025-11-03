// services/ups/rating.js
const { createHttp } = require('../../utils/https');
const { getToken } = require('./oauth');
const cfg = require('../../config/ups');

const http = createHttp(cfg.timeoutMs);

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

async function quote(payload) {
    try {
        const token = await getToken();

        const res = await http.post(
            cfg.rate,
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

        // UPS já devolve RateResponse/rateResponse
        return res.data;
    } catch (err) {
        const status = err?.response?.status || 500;
        const data = err?.response?.data;
        const headers = err?.response?.headers;

        console.error('UPS RATE error =>', {
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

module.exports = { quote };
