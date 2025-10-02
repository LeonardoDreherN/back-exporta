const base = process.env.UPS_ENV === 'PROD'
    ? process.env.UPS_BASE_URL_PROD
    : process.env.UPS_BASE_URL_CIE;

module.exports = {
    base,
    oauth: `${base}/security/v1/oauth/token`,
    rate: `${base}/api/rating/v2407/Rate`,
    ship: `${base}/api/shipments/v2407/ship`,
    track: `${base}/api/track/v1/details`,
    account: process.env.UPS_ACCOUNT,
    clientId: process.env.UPS_CLIENT_ID,
    clientSecret: process.env.UPS_CLIENT_SECRET,
    timeoutMs: 15000,
};
