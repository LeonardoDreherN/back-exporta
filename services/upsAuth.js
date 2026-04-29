const axios = require('axios')

const UPS_BASE = process.env.UPS_BASE_URL_PROD || 'https://onlinetools.ups.com';
const UPS_CLIENT_ID = process.env.UPS_CLIENT_ID || '';
const UPS_CLIENT_SECRET = process.env.UPS_CLIENT_SECRET || '';
const UPS_ACCOUNT_NUMBER = process.env.UPS_ACCOUNT_NUMBER || process.env.UPS_ACCOUNT || '';

// Cache por merchantId para suportar credenciais por cliente
const _tokenCacheMap = {};

// Aceita: getUpsToken() | getUpsToken(true) | getUpsToken(false, { clientId, clientSecret, merchantId })
async function getUpsToken(force = false, creds = {}) {
    const clientId = creds.clientId || UPS_CLIENT_ID;
    const clientSecret = creds.clientSecret || UPS_CLIENT_SECRET;
    const merchantId = creds.merchantId || UPS_ACCOUNT_NUMBER;
    const cacheKey = merchantId || '__global__';

    const now = Date.now();
    const cached = _tokenCacheMap[cacheKey];
    if (!force && cached?.token && now < cached.expTs - 60_000) {
        return cached.token;
    }
    if (!clientId || !clientSecret) {
        throw new Error('UPS OAuth2: defina UPS_CLIENT_ID e UPS_CLIENT_SECRET no .env');
    }
    const oauthUrl = `${UPS_BASE}/security/v1/oauth/token`;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const resp = await axios.post(
        oauthUrl,
        'grant_type=client_credentials',
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${basic}`,
                'Accept': 'application/json',
                ...(merchantId ? { 'x-merchant-id': merchantId } : {}),
            },
            timeout: 15000,
        }
    );

    const token = resp?.data?.access_token;
    const expiresIn = Number(resp?.data?.expires_in || 0);
    if (!token) throw new Error('UPS OAuth2: token ausente na resposta');

    _tokenCacheMap[cacheKey] = {
        token,
        expTs: Date.now() + expiresIn * 1000,
    };
    return token;
}

module.exports = { getUpsToken }
