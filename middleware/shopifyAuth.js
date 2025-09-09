const db = require('../models');
const { norm } = require('../utils/norm');

function extrairLojaDoHost(host) {
    try {
        const dec = Buffer.from(String(host || ''), 'base64').toString('utf8');
        const m = dec.match(/([a-z0-9-]+\.myshopify\.com)/i);
        return m ? m[1].toLowerCase() : null;
    } catch { return null; }
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
    const token = row?.accessToken || row?.accesstoken || null;
    return { token, scope: row?.scope || null };
}

async function comLoja(req, res, next) {
    let shopRow;
    try {
        const clienteId = req.clienteId ?? res.locals?.clienteId;
        if (!clienteId) return res.status(401).json({ erro: "Cliente nao autenticado" });

        let candidate = norm(req.query.shop);
        if (!candidate && req.query.host) candidate = extrairLojaDoHost(req.query.host);

        // 1) Se o cliente enviou um domínio, valide a propriedade:
        if (candidate) {
            shopRow = await db.InfoShopify.findOne({
                where: { id_cliente: clienteId, shopDomain: candidate },
                attributes: ["shopDomain", "apiVersion"],
                raw: true,
            });
            if (!shopRow) {
                return res.status(403).json({ erro: "Esta loja não pertence à sua conta" });
            }
        } else {
            // opcional: pegar a loja padrão/mais recente do cliente
            shopRow = await db.InfoShopify.findOne({
                where: { id_cliente: clienteId },
                attributes: ["shopDomain", "apiVersion"],
                order: [["createdAt", "DESC"]],
                raw: true,
            });
            if (!shopRow) {
                return res.status(404).json({ erro: "Cliente não possui loja conectada" });
            }
        }

        const shop = norm(shopRow.shopDomain);
        const tok = await db.Shop.findOne({ where: { shop }, attributes: ["accessToken"], raw: true });
        if (!tok?.accessToken) return res.status(401).json({ erro: "Loja nao autenticada/instalada" });

        // 4) Contexto para o controller
        req.shopDomain = shop;
        req.shopToken = tok.accessToken;
        req.apiVersion = shopRow.apiVersion; // opcional: usar a versão salva

        return next();
    } catch (e) {
        return next(e);
    }
}

async function garantirInstalada(req, res, next) {
    const rec = await db.Shop.findByPk(req.shopDomain);
    if (!rec) {
        return res.redirect(`/shopify/auth?shop=${encodeURIComponent(req.shopDomain)}`); // << crases
    }
    req.shopToken = rec.accessToken;
    next();
}


module.exports = { comLoja, garantirInstalada, getShopFromInfoShopify, getAccessTokenForShop };
