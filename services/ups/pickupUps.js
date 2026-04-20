const { createHttp } = require('../../utils/https');
const cfg = require('../../config/ups');
const { getToken } = require('./oauth');

const http = createHttp(cfg.timeoutMs);

function extractUpsMessage(err) {
    const data = err?.response?.data || err?.upstream;
    if (!data) return null;

    return (
        data?.response?.errors?.[0]?.message ||
        data?.response?.errors?.[0]?.code ||
        data?.errors?.[0]?.message ||
        data?.message ||
        data?.error_description ||
        data?.error ||
        null
    );
}

async function createPickup(payload, { transactionId } = {}) {
    try {
        const token = await getToken();

        const headers = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            transId: transactionId || `pickup-${Date.now()}`,
            transactionSrc: 'exporta-digital',
        };

        const res = await http.post(cfg.pickupCreate, payload, {
            headers,
            timeout: cfg.timeoutMs || 15000,
            validateStatus: s => s < 500,
        });

        if (res.status >= 400) {
            const msg = extractUpsMessage({ response: res }) || `UPS Pickup ${res.status}`;
            const e = new Error(msg);
            e.status = res.status;
            e.upstream = res.data;
            throw e;
        }

        return res.data;
    } catch (err) {
        const status = err?.response?.status || err.status || 500;
        const data = err?.response?.data || err.upstream;

        const e = new Error(
            extractUpsMessage(err) || `UPS Pickup failed with status ${status}`
        );
        e.status = status;
        e.upstream = data;
        throw e;
    }
}

module.exports = {
    createPickup,
};