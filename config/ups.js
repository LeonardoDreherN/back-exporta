const base = process.env.UPS_ENV === 'PROD'
    ? process.env.UPS_BASE_URL_PROD || "https://onlinetools.ups.com"
    : process.env.UPS_BASE_URL_CIE || "https://wwwcie.ups.com";

module.exports = {
    base,
    oauth: `${base}/security/v1/oauth/token`,
    rate: `${base}/api/rating/v2407/Rate`,
    ship: `${base}/api/shipments/v2407/ship`,
    track: `${base}/api/track/v1/details`,
    pickupCreate: `${base}/api/pickupcreation/v2407/pickup`,
    account: process.env.UPS_ACCOUNT_NUMBER,
    clientId: process.env.UPS_CLIENT_ID,
    clientSecret: process.env.UPS_CLIENT_SECRET,
    timeoutMs: 15000,
};