const qs = require('querystring');
const { createHttp } = require('../../utils/https');
const cfg = require('../../config/ups');

let cache = { token: null, exp: 0 };
const http = createHttp(cfg.timeoutMs);

async function getToken() {
    const now = Date.now();
    if (cache.token && now < cache.exp - 60_000) return cache.token;

    const body = qs.stringify({ grant_type: 'client_credentials' });
    const res = await http.post(cfg.oauth, body, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'x-merchant-id': cfg.account,
            Authorization: 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')
        }
    });
    console.log("xxx: ", cfg.account)
    cache.token = res.data.access_token;
    cache.exp = now + (res.data.expires_in * 1000);
    return cache.token;
}

module.exports = { getToken };
