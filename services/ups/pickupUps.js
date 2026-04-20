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

        // 🔍 LOG DO PAYLOAD ENVIADO
        console.log('[UPS PICKUP PAYLOAD]');
        console.log(JSON.stringify(payload, null, 2));

        const res = await http.post(cfg.pickupCreate, payload, {
            headers,
            timeout: cfg.timeoutMs || 15000,
            validateStatus: s => s < 500,
        });

        // 🔍 LOG DA RESPOSTA DA UPS
        console.log('[UPS PICKUP RESPONSE]');
        console.log('status:', res.status);
        console.log(JSON.stringify(res.data, null, 2));

        if (res.status >= 400) {
            const msg = extractUpsMessage({ response: res }) || `UPS Pickup ${res.status}`;
            const e = new Error(msg);
            e.status = res.status;
            e.upstream = res.data;

            console.error('[UPS PICKUP ERROR - UPS RESPONSE]');
            console.error(JSON.stringify(res.data, null, 2));

            throw e;
        }

        return res.data;
    } catch (err) {
        const status = err?.response?.status || err.status || 500;
        const data = err?.response?.data || err.upstream;

        console.error('[UPS PICKUP ERROR]');
        console.error('status:', status);
        console.error('message:', err.message);
        console.error('upstream:', JSON.stringify(data, null, 2));

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