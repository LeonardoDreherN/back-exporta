// backend/services/fedex/ship.js
const { createHttp } = require('../../utils/https');
const { getToken } = require('./oauth');
const cfg = require('../../config/fedex');

const http = createHttp(cfg.timeoutMs);

// Extrai a melhor mensagem possível do payload da FedEx
function extractFedexMessage(err) {
    const data = err?.response?.data;
    if (!data) return null;

    return (
        data?.errors?.[0]?.message ||         // { errors:[{ code, message }]}
        data?.output?.alerts?.[0]?.message || // alguns retornos trazem alerts
        data?.error_description ||            // OAuth/geral
        data?.error ||                        // OAuth/geral
        null
    );
}

/**
 * Emissão (Shipping) FedEx
 * @param {object} payload Body completo no formato FedEx
 * @param {{ idempotencyKey?: string }} opts
 * @returns {Promise<any>} data bruto da FedEx
 */
async function createShipment(payload, { idempotencyKey } = {}) {
    try {
        const token = await getToken();

        const headers = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'x-customer-transaction-id': `intrex-${Date.now()}`,
        };
        if (idempotencyKey) headers['x-customer-transaction-id'] = idempotencyKey;

        // [ADD] valida accountNumber e garante value
        const accountNumber = payload?.accountNumber?.value
            ? payload.accountNumber
            : { value: cfg.accountNumber };

        const body = {
            ...payload,
            accountNumber, // [CHANGE] injeta/normaliza accountNumber
        };

        // [ADD] validateStatus para capturar 4xx e devolver JSON da FedEx
        const res = await http.post(cfg.ship, body, {
            headers,
            timeout: cfg.timeoutMs || 30000,
            validateStatus: s => s < 500,
        });

        if (res.status >= 400) {
            console.error('[FEDEX SHIP][UPSTREAM]', res.status, res.data);
            const msg = extractFedexMessage({ response: res }) || `FedEx Ship ${res.status}`;
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

        console.error('FEDEX SHIP error =>', {
            status,
            correlation:
                headers?.['x-customer-transaction-id'] ||
                headers?.['x-correlation-id'] ||
                null,
            data,
        });

        const e = new Error(extractFedexMessage(err) || `FedEx Ship failed with status ${status}`);
        e.status = status;
        e.upstream = data;
        throw e;
    }
}

module.exports = { createShipment };
