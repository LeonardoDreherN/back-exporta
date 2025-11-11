// services/fedex/track.js
const axios = require('axios');
const { getFedexToken, baseUrl } = require('./auth');

async function trackNumbers(trackingNumbers = []) {
    const token = await getFedexToken();
    const url = `${baseUrl()}/track/v1/trackingnumbers`;
    const body = {
        trackingInfo: trackingNumbers.map(n => ({ trackingNumberInfo: { trackingNumber: n } })),
        includeDetailedScans: true,
    };
    const { data } = await axios.post(url, body, {
        headers: {
            Authorization: `Bearer ${token}`,
            'x-customer-transaction-id': `intrex-${Date.now()}`,
            'Content-Type': 'application/json',
        },
    });
    return data;
}

module.exports = { trackNumbers };
