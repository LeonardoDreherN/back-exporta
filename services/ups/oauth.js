const qs = require('querystring');
const { createHttp } = require('../../utils/https');
const cfg = require('../../config/ups');

// Cache por merchantId para suportar credenciais por cliente
const cacheMap = {};
const http = createHttp(cfg.timeoutMs);

// Aceita: getToken() | getToken(true) | getToken(false, { clientId, clientSecret, merchantId })
async function getToken(forceOrOpts = false, extraCreds = {}) {
    const force = typeof forceOrOpts === 'boolean' ? forceOrOpts : false;
    const opts = (typeof forceOrOpts === 'object' && forceOrOpts !== null) ? forceOrOpts : extraCreds;

    const clientId = opts.clientId || cfg.clientId;
    const clientSecret = opts.clientSecret || cfg.clientSecret;
    const merchantId = opts.merchantId || cfg.account;
    const cacheKey = merchantId || '__global__';

    const now = Date.now();
    const cached = cacheMap[cacheKey];

    if (!force && cached?.token && now < cached.exp - 60_000) {
        return cached.token;
    }

    const body = qs.stringify({ grant_type: 'client_credentials' });

    const res = await http.post(cfg.oauth, body, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            ...(merchantId ? { 'x-merchant-id': merchantId } : {}),
            Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        }
    });

    const token = res.data.access_token;
    cacheMap[cacheKey] = { token, exp: now + (res.data.expires_in * 1000) };

    return token;
}

module.exports = { getToken };
