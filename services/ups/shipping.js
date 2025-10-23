// const { createHttp } = require('../../utils/https');
// const { getToken } = require('./oauth');
// const cfg = require('../../config/ups');
// const http = createHttp(cfg.timeoutMs);

// async function createShipment(payload, { idempotencyKey } = {}) {
//     const token = await getToken();
//     const headers = {
//         Authorization: `Bearer ${token}`,
//         'Content-Type': 'application/json'
//     };
//     if (idempotencyKey) headers['x-transaction-id'] = idempotencyKey;

//     const res = await http.post(cfg.ship, payload, { headers });
//     return res.data;
// }

// module.exports = { createShipment };

// backend/services/ups/shipping.js
const { createHttp } = require('../../utils/https');
const { getToken } = require('./oauth');
const cfg = require('../../config/ups');

const http = createHttp(cfg.timeoutMs);

// Extrai a melhor mensagem possível do payload da UPS
function extractUpsMessage(err) {
    const data = err?.response?.data;
    if (!data) return null;

    return (
        // REST JSON moderno
        data?.response?.errors?.[0]?.message ||
        data?.response?.errors?.[0]?.code ||
        // SOAP/legados
        data?.Fault?.detail?.Errors?.ErrorDetail?.PrimaryErrorCode?.Description ||
        data?.Fault?.detail ||
        // OAuth/Genérico
        data?.error_description ||
        data?.error ||
        null
    );
}

/**
 * Emissão (Shipping) UPS
 * @param {object} payload Payload completo do UPS Ship/ShipmentRequest
 * @param {{ idempotencyKey?: string }} opts
 * @returns {Promise<any>}
 */
async function createShipment(payload, { idempotencyKey } = {}) {
    try {
        const token = await getToken();

        const headers = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            // ajuda em suporte/trace na UPS
            transactionSrc: 'back-exporta',
        };
        if (idempotencyKey) headers['x-transaction-id'] = idempotencyKey;

        const res = await http.post(
            cfg.ship,               // ex.: https://onlinetools.ups.com/api/shipments
            payload,
            { headers, timeout: cfg.timeoutMs || 30000 }
        );

        return res.data;
    } catch (err) {
        const status = err?.response?.status || 500;
        const data = err?.response?.data;
        const headers = err?.response?.headers;

        // Log detalhado no servidor para debug
        console.error('UPS SHIP error =>', {
            status,
            correlation:
                headers?.['transId'] ||
                headers?.['x-correlation-id'] ||
                headers?.['x-transaction-id'] ||
                null,
            data,
        });

        // Propaga erro “limpo” com mensagem útil
        const e = new Error(extractUpsMessage(err) || `UPS Ship failed with status ${status}`);
        e.status = status;
        e.upstream = data;
        throw e;
    }
}

module.exports = { createShipment };
