const { createHttp } = require('../../utils/https');
const cfg = require('../../config/fedex');
const { getToken } = require("./authFedex");

const http = createHttp(cfg.timeoutMs);

function extractFedexMessage(err) {
    const data = err?.response?.data;
    if (!data) return null;

    return (
        data?.errors?.[0]?.message ||
        data?.output?.alerts?.[0]?.message ||
        data?.error_description ||
        data?.error ||
        null
    );
}

async function createPickup(payload, { idempotencyKey } = {}) {
    try {
        const token = await getToken();

        const headers = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'x-customer-transaction-id': `intrex-${Date.now()}`,
        };
        if (idempotencyKey) headers['x-customer-transaction-id'] = idempotencyKey;

        const res = await http.post(cfg.pickup, payload, {
            headers,
            timeout: cfg.timeoutMs || 30000,
            validateStatus: s => s < 500,
        });

        if (res.status >= 400) {
            const msg = extractFedexMessage({ response: res }) || `FedEx Pickup ${res.status}`;
            const e = new Error(msg);
            e.status = res.status;
            e.upstream = res.data;
            throw e;
        }

        return res.data;
    } catch (err) {
        const status = err?.response?.status || err.status || 500;
        const data = err?.response?.data || err.upstream;
        const headers = err?.response?.headers;

        const e = new Error(extractFedexMessage(err) || `FedEx Pickup failed with status ${status}`);
        e.status = status;
        e.upstream = data;
        e.correlation =
            headers?.['x-customer-transaction-id'] ||
            headers?.['x-correlation-id'] ||
            null;
        throw e;
    }
}

module.exports = { createPickup };