const db = require('../models');

function extrairLojaDoHost(host) {
    try {
        const dec = Buffer.from(String(host || ''), 'base64').toString('utf8');
        const m = dec.match(/([a-z0-9-]+\.myshopify\.com)/i);
        return m ? m[1].toLowerCase() : null;
    } catch { return null; }
}

function comLoja(req, res, next) {
    let shop = (req.query.shop || '').toLowerCase();
    if (!shop && req.query.host) shop = extrairLojaDoHost(req.query.host);
    if (!shop && process.env.NODE_ENV !== 'production') shop = process.env.DEV_SHOP;
    if (!shop) return res.status(400).send('Missing shop');
    req.shopDomain = shop;
    next();
}

async function garantirInstalada(req, res, next) {
    const rec = await db.Shop.findByPk(req.shopDomain);
    if (!rec) {
        return res.redirect(`/shopify/auth?shop=${encodeURIComponent(req.shopDomain)}`); // << crases
    }
    req.shopToken = rec.accessToken;
    next();
}

module.exports = { comLoja, garantirInstalada };
