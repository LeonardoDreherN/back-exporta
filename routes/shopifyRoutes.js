const express = require('express');
const crypto = require('crypto');
const db = require('../models');
const { autenticarJWT, autenticar } = require('../middleware/auth');

const router = express.Router();

function isValidShopDomain(shop) {
    return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop || '');
}
function getScopes() {
    return (process.env.SHOPIFY_API_SCOPES || process.env.SCOPES || '')
        .split(',').map(s => s.trim()).filter(Boolean).join(',');
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

// /shopify/auth
router.get('/auth', (req, res) => {
    const { shop } = req.query;
    if (!shop || !isValidShopDomain(shop)) {
        return res.status(400).send('Parametro "shop" invalido');
    }

    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('shopify_state', state, { httpOnly: true, sameSite: 'lax', secure: true });
    const APP_URL = (process.env.SHOPIFY_APP_URL || process.env.HOST || '').replace(/\/$/, '');
    const redirectUri = `${APP_URL}/shopify/auth/callback`;         // << crases
    const scopes = getScopes();

    const url = new URL(`https://${shop}/admin/oauth/authorize`);  // << crases
    url.searchParams.set('client_id', process.env.SHOPIFY_API_KEY);
    url.searchParams.set('scope', scopes);
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
                client_id: process.env.SHOPIFY_API_KEY,
                client_secret: process.env.SHOPIFY_API_SECRET,
                code
            })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.access_token) {
            console.error('[callback] access_token error:', r.status, j);
            return res.status(r.status).send('OAuth error');
        }

        await db.Shop.upsert({ shop: shop.toLowerCase(), accessToken: j.access_token, scope: j.scope || null });
        console.log('[callback] token salvo para', shop);

        return res.redirect(`https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`);
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
