const db = require('../models');
const { norm } = require('../utils/norm');

function extrairLojaDoHost(host) {
    try {
        const dec = Buffer.from(String(host || ''), 'base64').toString('utf8'); // "admin.shopify.com/store/<handle>"
        const m = dec.match(/admin\.shopify\.com\/store\/([a-z0-9-]+)/i);
        return m ? (m[1].toLowerCase() + '.myshopify.com') : null;
    } catch {
        return null;
    }
}

async function getShopFromInfoShopify(clienteId) {
    if (!clienteId) return null;
    const rec = await db.InfoShopify.findOne({
        where: { id_cliente: clienteId },
        attributes: ["shopDomain"],
        order: [["updatedAt", "DESC"]],
    });
    return rec?.shopDomain ? rec.shopDomain.toLowerCase() : null;
}

async function getAccessTokenForShop(shopDomain) {
    const row = await db.Shop.findOne({
        where: { shop: shopDomain },
        attributes: ['shop', 'accessToken', 'scope'],
        raw: true
    });
    const token = row?.accessToken || null;
    return { token, scope: row?.scope || null };
}

async function comLoja(req, res, next) {
    try {
        let clienteId = req.clienteId ?? res.locals?.clienteId;

        let candidate = norm(req.query.shop);
        if (!candidate && req.query.host) candidate = extrairLojaDoHost(req.query.host);

        if (!clienteId && candidate) {
            const dono = await db.InfoShopify.findOne({
                where: { shopDomain: candidate },
                attributes: ['id_cliente', 'shopDomain'],
                raw: true,
            });
            if (dono) {
                clienteId = dono.id_cliente;
                // opcionalmente disponibiliza:
                req.clienteId = dono.id_cliente;
                res.locals.clienteId = dono.id_cliente;
            }
        }

        let shopRow = null;
        if (!candidate && clienteId) {
            shopRow = await db.InfoShopify.findOne({
                where: { id_cliente: clienteId },
                attributes: ['shopDomain'],
                order: [['createdAt', 'DESC']],
                raw: true,
            });
            if (!shopRow) return res.status(404).json({ erro: 'Cliente não possui loja conectada' });
        }

        if (candidate && !shopRow) {
            shopRow = { shopDomain: candidate };
        }

        if (!shopRow) {
            return res.status(400).json({ erro: 'Não foi possível determinar a loja (shop/host ausente)' });
        }

        const shop = norm(shopRow.shopDomain);
        const tok = await db.Shop.findOne({ where: { shop }, attributes: ["accessToken"], raw: true });

        req.shopDomain = shop;
        req.shopToken = tok?.accessToken || null;   // <-- sem 401 aqui
        next();
    } catch (e) { next(e); }
}

async function garantirInstalada(req, res, next) {
    const rec = await db.Shop.findByPk(req.shopDomain);
    if (!rec) {
        const APP_URL = (process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
        const url = `${APP_URL}/shopify/auth?shop=${encodeURIComponent(req.shopDomain)}`;
        return res.redirect(url); // URL ABSOLUTA, não relativa
    }
    req.shopToken = rec.accessToken;
    next();
}


module.exports = { comLoja, garantirInstalada, getShopFromInfoShopify, getAccessTokenForShop };
