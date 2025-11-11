// backend/services/fedex/oauth.js
const axios = require('axios');
const cfg = require('../../config/fedex');

let tokenCache = { token: null, exp: 0 };

async function getToken() {
    const now = Date.now();
    if (tokenCache.token && now < tokenCache.exp - 60_000) return tokenCache.token;

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', cfg.clientId);
    params.append('client_secret', cfg.clientSecret);

    // [ADD] permite definir escopo via config se o app exigir
    if (cfg.scope) params.append('scope', cfg.scope); // ex.: ship.shipments

    try {
        // [ADD] validateStatus para capturar 400 e logar conteúdo
        const res = await axios.post(
            cfg.oauth,                      // ex.: https://apis-sandbox.fedex.com/oauth/token
            params.toString(),              // [CHANGE] força string (evita edge cases)
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: cfg.timeoutMs,
                validateStatus: s => s < 500, // deixa 4xx cair no fluxo normal
            }
        );

        if (res.status !== 200) {
            console.error('[FEDEX OAUTH][UPSTREAM]', res.status, res.data); // [ADD] log detalhado
            throw new Error(`FedEx OAuth ${res.status}`);
        }

        tokenCache = {
            token: res.data.access_token,
            exp: now + (res.data.expires_in || 3600) * 1000,
        };
        return tokenCache.token;
    } catch (err) {
        // [ADD] log completo em caso de network/timeout/etc.
        const status = err.response?.status;
        const data = err.response?.data;
        console.error('[FEDEX OAUTH][ERROR]', status ?? '', data ?? err.message);
        throw err;
    }
}

module.exports = { getToken };
