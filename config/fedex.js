const { account } = require("./ups");

const base = process.env.NODE_ENV === 'production'
    ? (process.env.FEDEX_BASE_URL_PROD || 'https://apis.fedex.com')
    : (process.env.FEDEX_BASE_URL || 'https://apis-sandbox.fedex.com');

console.log(">>>>>", base)

module.exports = {
    base,
    oauth: `${base}/oauth/token`,
    rateQuotes: `${base}/rate/v1/rates/quotes`,
    ship: `${base}/ship/v1/shipments`,
    clientId: process.env.FEDEX_KEY,
    clientSecret: process.env.FEDEX_KEY_SECRET,
    clientIdTrack: process.env.FEDEX_KEY_TRACK,
    clientSecretTrack: process.env.FEDEX_KEY_SECRET_TRACK,
    accountNumber: process.env.FEDEX_ACCOUNT_NUMBER,
    scope: process.env.FEDEX_SCOPE || '',
    timeoutMs: Number(process.env.FEDEX_TIMEOUT_MS || 30000),
};
