const db = require('../models');

async function getAccessTokenForStore(storeId) {
    const row = await db.NuvemshopShop.findOne({
        where: { storeId: String(storeId) },
        attributes: ['storeId', 'accessToken', 'scope'],
        raw: true,
    });
    return { token: row?.accessToken || null, scope: row?.scope || null };
}

module.exports = { getAccessTokenForStore };
