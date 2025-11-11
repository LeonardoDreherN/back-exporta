const upsRating = require('../ups/rating');
const normUps = require('../../utils/normalize/upsRate');
const normFedex = require('../../utils/normalize/fedexRate');

async function rateMulti(input) {
    const quotes = [];
    const warnings = [];

    try {
        const upsResp = await upsRating.quote(input);
        quotes.push(...normUps(upsResp));
    } catch (e) {
        warnings.push(`UPS: ${e.message || 'falhou'}`);
    }

    // try {
    //     const fxResp = await fedexRating.quote(input); // stub
    //     quotes.push(...normFedex(fxResp));             // retorna []
    // } catch (e) {
    //     warnings.push(`FedEx: ${e.message || 'indisponível'}`);
    // }

    quotes.sort((a, b) => (a.currency === b.currency) ? (a.total - b.total) : 0);
    return { quotes, warnings };
}
module.exports = { rateMulti };
