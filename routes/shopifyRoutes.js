const express = require('express');
const crypto = require('crypto');
const db = require('../models');

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
    const message = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&'); // << crases
    const digest = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(message).digest('hex');
    return digest.length === receivedHmac.length && crypto.timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(receivedHmac, 'utf8'));
}

// “armazenamento” de dev
const tokenLoja = new Map();
const stateLoja = new Map();

// /shopify/auth
router.get('/auth', (req, res) => {
    const { shop } = req.query;
    if (!shop || !isValidShopDomain(shop)) {
        return res.status(400).send('Parametro "shop" invalido');
    }

    const state = crypto.randomBytes(16).toString('hex');
    stateLoja.set(state, shop);

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
        const { shop, code, hmac, state } = req.query;
        if (!shop || !code || !hmac || !state) return res.status(400).send('Missing params');
        if (!isValidShopDomain(shop)) return res.status(400).send('Invalid shop');
        if (stateLoja.get(state) !== shop) return res.status(401).send('Invalid state');
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
        if (!r.ok) return res.status(r.status).send(await r.text());
        const { access_token, scope } = await r.json();

        // salva em memória (dev)
        tokenLoja.set(shop, { token: access_token, scope, updatedAt: new Date() });

        // salva no DB (o garantirInstalada olha aqui)
        await db.Shop.upsert({ shop, accessToken: access_token, scope });

        stateLoja.delete(state);

        // volta para o app embed no Admin
        return res.redirect(`https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`); // << crases
    } catch (e) {
        console.error('OAuth callback error:', e);
        return res.status(500).send('OAuth error');
    }
});

module.exports = { router, tokenLoja, stateLoja };
