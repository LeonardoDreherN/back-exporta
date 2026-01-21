const axios = require('axios')

const UPS_BASE = process.env.UPS_BASE_URL_PROD || 'https://onlinetools.ups.com';
const UPS_CLIENT_ID = process.env.UPS_CLIENT_ID || '';
const UPS_CLIENT_SECRET = process.env.UPS_CLIENT_SECRET || '';
const UPS_ACCOUNT_NUMBER = process.env.UPS_ACCOUNT_NUMBER || process.env.UPS_ACCOUNT || '';

let _upsTokenCache = { token: null, expTs: 0 }; // epoch ms
async function getUpsToken(force = false) {
    const now = Date.now();
    if (!force && _upsTokenCache.token && now < _upsTokenCache.expTs - 60_000) {
        return _upsTokenCache.token;
    }
    if (!UPS_CLIENT_ID || !UPS_CLIENT_SECRET) {
        throw new Error('UPS OAuth2: defina UPS_CLIENT_ID e UPS_CLIENT_SECRET no .env');
    }
    const oauthUrl = `${UPS_BASE}/security/v1/oauth/token`;
    const basic = Buffer.from(`${UPS_CLIENT_ID}:${UPS_CLIENT_SECRET}`).toString('base64');

    const resp = await axios.post(
        oauthUrl,
        'grant_type=client_credentials',
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${basic}`,
                'Accept': 'application/json',
                ...(UPS_ACCOUNT_NUMBER ? { 'x-merchant-id': UPS_ACCOUNT_NUMBER } : {}),
            },
            timeout: 15000,
        }
    );

    const token = resp?.data?.access_token;
    const expiresIn = Number(resp?.data?.expires_in || 0);
    if (!token) throw new Error('UPS OAuth2: token ausente na resposta');

    _upsTokenCache = {
        token,
        expTs: Date.now() + expiresIn * 1000,
    };
    return token;
}

module.exports = { getUpsToken }
