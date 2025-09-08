const db = require('../models');

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
    if (!shopDomain) return null;
    const shop = await db.Shop.findOne({
        where: { shop: shopDomain },
        // inclua 'accessToken' (ou o nome que você usa) nos atributos
        attributes: ["shop", "accessToken", "scope", "updatedAt"],
    });
    return shop?.accessToken || null;
}

async function comLoja(req, res, next) {
    try {
        const clienteId = req.clienteId ?? res.locals?.clienteId;
        if (!clienteId) return res.status(401).json({ erro: "Cliente nao autenticado" });

        let candidate = norm(req.query.shop);
        if (!candidate && req.query.host) candidate = extrairLojaDoHost(req.query.host);

        let shopRow;
        // 1) Se o cliente enviou um domínio, valide a propriedade:
        if (candidate) {
            if (!reShop.test(candidate)) return res.status(400).json({ erro: "shop inválido" });
            shopRow = await db.InfoShopify.findOne({
                where: { id_cliente: clienteId, shopDomain: candidate },
                attributes: ["shopDomain", "apiVersion"],
                raw: true,
            });
            if (!shopRow) {
                return res.status(403).json({ erro: "Esta loja não pertence à sua conta" });
            }
        }
        // 2) Senão, pegue a loja do próprio usuário:
        else {
            shopRow = await db.InfoShopify.findOne({
                where: { id_cliente: clienteId },
                attributes: ["shopDomain", "apiVersion"],
                order: [["updatedAt", "DESC"]],
                raw: true,
            });
            if (!shopRow) return res.status(400).json({ erro: "Missing shop" });
        }

        const shop = norm(shopRow.shopDomain);
        const apiVersion = shopRow.apiVersion;

        // 3) Busque o access token da mesma loja
        const tok = await db.Shop.findOne({
            where: { shop },
            attributes: ["accessToken"],
            raw: true,
        });
        if (!tok?.accessToken) {
            return res.status(401).json({ erro: "Loja nao autenticada/instalada" });
        }

        // 4) Contexto para o controller
        req.shopDomain = shop;
        req.shopToken = tok.accessToken;
        req.apiVersion = apiVersion; // opcional: usar a versão salva

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
