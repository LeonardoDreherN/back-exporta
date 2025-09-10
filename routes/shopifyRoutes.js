const express = require('express');
const crypto = require('crypto');
const db = require('../models');
const { autenticar } = require('../middleware/auth');
require('dotenv').config();

const router = express.Router();

const APP_URL = process.env.SHOPIFY_APP_URL.replace(/\/$/, ''); // https://...trycloudflare.com
const API_KEY = process.env.SHOPIFY_API_KEY;
const API_SECRET = process.env.SHOPIFY_API_SECRET;
const SCOPES = process.env.SHOPIFY_API_SCOPES; // + o que precisar

function isValidShopDomain(shop) {
    return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop || '');
}

function isValidHmac(query) {
    const receivedHmac = String(query.hmac || '');
    const params = { ...query }; delete params.hmac; delete params.signature;
    const message = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
    const digestHex = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET)
        .update(message).digest('hex');
    try {
        return digestHex.length === receivedHmac.length &&
            crypto.timingSafeEqual(Buffer.from(digestHex, 'hex'), Buffer.from(receivedHmac, 'hex'));
    } catch {
        return false;
    }
}

function toStoreHandle(shopOrHost) {
    if (!shopOrHost) return null;

    // "thiago123456.myshopify.com" -> "thiago123456"
    const m1 = String(shopOrHost).match(/^([a-z0-9-]+)\.myshopify\.com$/i);
    if (m1) return m1[1].toLowerCase();

    // (opcional) se um dia vier host base64 do Admin
    try {
        const dec = Buffer.from(String(shopOrHost), 'base64').toString('utf8'); // "admin.shopify.com/store/<store>"
        const m2 = dec.match(/store\/([a-z0-9-]+)/i);
        if (m2) return m2[1].toLowerCase();
    } catch { }
    return null;
}

// /shopify/auth
router.get('/auth', (req, res) => {
    const { shop } = req.query;
    if (!shop || !isValidShopDomain(shop)) {
        return res.status(400).send('Parametro "shop" invalido');
    }

    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('shopify_state', state, { httpOnly: true, sameSite: 'none', secure: true });
    const redirectUri = `${APP_URL}/shopify/auth/callback`;         // << crases

    const url = new URL(`https://${shop}/admin/oauth/authorize`);  // << crases
    url.searchParams.set('client_id', API_KEY);
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);

    console.log('Auth redirect_uri =>', redirectUri);
    return res.redirect(url.toString());
});

// /shopify/auth/callback
router.get('/auth/callback', async (req, res) => {
    try {
        console.log('[callback] HIT', req.query);
        const { shop, code, hmac, state } = req.query;
        if (!shop || !code || !hmac || !state) return res.status(400).send('Missing params');
        if (!isValidShopDomain(shop)) return res.status(400).send('Invalid shop');

        if (!req.cookies || req.cookies.shopify_state !== state) {
            console.warn('[callback] invalid state', { cookie: req.cookies?.shopify_state, state });
            return res.status(401).send('Invalid state');
        }
        res.clearCookie('shopify_state');
        if (!isValidHmac(req.query)) return res.status(401).send('Invalid HMAC');

        
        const r = await fetch(`https://${shop}/admin/oauth/access_token`, { // << crases
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: API_KEY,
                client_secret: API_SECRET,
                code
            })
        });
        console.log(code)
        const { access_token, scope } = await r.json();
        await db.Shop.upsert({ shop: shop.toLowerCase(), accessToken: access_token, scope });
        console.log(access_token)
        // const host = req.query.host || Buffer.from(`${shop}/admin`).toString('base64')
        
        const store = toStoreHandle(shop)
        const embeddedUrl = `https://admin.shopify.com/store/${store}/apps/apptest-276`;
        return res.redirect(embeddedUrl);
    } catch (e) {
        console.error('OAuth callback error:', e);
        return res.status(500).send('OAuth error');
    }
});

router.get('/has-token', async (req, res) => {
    const shop = String(req.query.shop || '').toLowerCase().trim();
    const row = await db.Shop.findOne({ where: { shop }, attributes: ['shop'], raw: true });
    res.json({ hasToken: !!row, shop });
});

router.get("/conexao", autenticar, async (req, res) => {
    try {
        const clienteId = req.clienteId ?? res.locals?.clienteId;
        if (!clienteId) return res.status(401).json({ erro: "Cliente nao autenticado!" });

        const loja = await db.InfoShopify.findOne({
            where: { id_cliente: clienteId },
            attributes: ["id", "shopDomain", "apiVersion", "createdAt", "updatedAt"],
        });

        if (!loja) return res.json({ connected: false });
        return res.json({ connected: true, loja });
    } catch (e) {
        console.error("Erro em GET /shopify/conexao:", e);
        return res.status(500).json({ erro: "Falha ao verificar conexão" });
    }
});

module.exports = router;
