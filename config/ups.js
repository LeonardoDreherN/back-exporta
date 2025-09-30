require('dotenv').config();

const isSandbox = (process.env.UPS_ENV || 'sandbox') === 'sandbox';

module.exports = {
    env: process.env.UPS_ENV || 'sandbox',
    version: process.env.UPS_API_VERSION || 'v2407',
    clientId: process.env.UPS_CLIENT_ID,
    clientSecret: process.env.UPS_CLIENT_SECRET,
    transactionSrc: process.env.UPS_TRANSACTION_SRC || 'back-exporta',
    oauthUrl: 'https://www.ups.com/security/v1/oauth/token',
    baseUrl: isSandbox ? 'https://wwwcie.ups.com' : 'https://onlinetools.ups.com',
};
