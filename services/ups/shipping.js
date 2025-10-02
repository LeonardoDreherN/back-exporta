const { createHttp } = require('../../utils/https');
const { getToken } = require('./oauth');
const cfg = require('../../config/ups');
const http = createHttp(cfg.timeoutMs);

async function createShipment(payload, { idempotencyKey } = {}) {
    const token = await getToken();
    const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
    if (idempotencyKey) headers['x-transaction-id'] = idempotencyKey;

    const res = await http.post(cfg.ship, payload, { headers });
    return res.data;
}

module.exports = { createShipment };
