// const db = require('../models');
// const { norm } = require('../utils/norm');

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
    const token = row?.accessToken || null;
    return { token, scope: row?.scope || null };
}

// middlewares/shopify.js
const { Op } = require('sequelize');
const db = require('../models');
const { norm } = require('../utils/norm');

function extrairLojaDoHost(host) {
    try {
        const dec = Buffer.from(String(host || ''), 'base64').toString('utf8');
        const m = dec.match(/([a-z0-9-]+\.myshopify\.com)/i);
        return m ? m[1].toLowerCase() : null;
    } catch { return null; }
}

async function comLoja(req, res, next) {
    let shopRow;
    try {
        const clienteId = req.clienteId ?? res.locals?.clienteId;
        if (!clienteId) return res.status(401).json({ erro: 'Cliente nao autenticado' });

        // 1) Descobrir a loja candidata (query.shop ou host embutido)
        let candidate = req.query.shop ? norm(req.query.shop) : null;
        if (!candidate && req.query.host) candidate = extrairLojaDoHost(req.query.host);

        // 2) Buscar a loja do cliente (valida propriedade)
        if (candidate) {
            shopRow = await db.InfoShopify.findOne({
                where: { id_cliente: clienteId, shopDomain: candidate },
                attributes: ['shopDomain', 'apiVersion'],
                raw: true,
            });
            if (!shopRow) {
                return res.status(403).json({ erro: 'Esta loja não pertence à sua conta' });
            }
        } else {
            shopRow = await db.InfoShopify.findOne({
                where: { id_cliente: clienteId },
                attributes: ['shopDomain', 'apiVersion'],
                order: [['createdAt', 'DESC']],
                raw: true,
            });
            if (!shopRow) {
                return res.status(404).json({ erro: 'Cliente não possui loja conectada' });
            }
        }

        // 3) Normalizar domínio canônico
        const shop = norm(shopRow.shopDomain);

        // 4) Procurar token (com fallbacks para registros antigos)
        const tok = await db.Shop.findOne({
            where: {
                [Op.or]: [
                    { shop },                          // canônico
                    { shop: `https://${shop}` },       // salvo com https
                    { shop: `${shop}/` },              // barra final
                    { shop: shop.toUpperCase() },      // caixa alta
                ],
            },
            attributes: ['shop', 'accessToken', 'scope'],
            raw: true,
        });

        // Logs úteis para diagnosticar
        console.log('[comLoja]',
            { clienteId, candidate, shopNorm: shop, tokenFound: !!tok?.accessToken, tokenFor: tok?.shop });

        if (!tok?.accessToken) {
            // Se for navegação (Accept: text/html), já redireciona para instalar
            const wantsHTML = /text\/html/.test(req.headers.accept || '');
            if (wantsHTML) {
                return res.redirect(`/shopify/auth?shop=${encodeURIComponent(shop)}`);
            }
            return res.status(401).json({
                erro: 'Loja nao autenticada/instalada',
                instalar: `/shopify/auth?shop=${encodeURIComponent(shop)}`,
            });
        }

        // 5) Contexto para controllers
        req.shopDomain = shop;
        req.shopToken = tok.accessToken;
        req.apiVersion = shopRow.apiVersion; // opcional

        return next();
    } catch (e) {
        return next(e);
    }
}

module.exports = { comLoja };


async function garantirInstalada(req, res, next) {
    const rec = await db.Shop.findByPk(req.shopDomain);
    if (!rec) {
        return res.redirect(`/shopify/auth?shop=${encodeURIComponent(req.shopDomain)}`); // << crases
    }
    req.shopToken = rec.accessToken;
    next();
}


module.exports = { comLoja, garantirInstalada, getShopFromInfoShopify, getAccessTokenForShop };
