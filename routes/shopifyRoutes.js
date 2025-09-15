function renderTopLevelRedirect({ apiKey, host, targetUrl }) {
    return `<!doctype html>
    <html><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Redirecionando…</title>
    <script src="https://unpkg.com/@shopify/app-bridge@3"></script>
    <style>body{font-family:system-ui,Segoe UI,Roboto; margin:0; padding:24px}</style>
    </head><body>Redirecionando…
    <script>
    (function () {
        var AB = window.appBridge || window['app-bridge'];
        var target = '${targetUrl}';
        if (!AB || !AB.createApp) { window.top.location.href = target; return; }
        var app = AB.createApp({ apiKey: '${apiKey}', host: '${host}', forceRedirect: true });
        var Redirect = AB.actions.Redirect;
        Redirect.create(app).dispatch(Redirect.Action.REMOTE, target);
        })();
        </script>
        </body></html>`;
}

const express = require('express');
const crypto = require('crypto');
const db = require('../models');
const { autenticarShopify } = require('../middleware/auth');
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

const usedAuthCodes = new Map(); // code -> timestamp
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

function isCodeUsed(code) {
    const now = Date.now();
    for (const [c, t] of usedAuthCodes) {
        if (now - t > AUTH_CODE_TTL_MS) usedAuthCodes.delete(c);
    }
    return usedAuthCodes.has(code);
}
function markCodeUsed(code) {
    usedAuthCodes.set(code, Date.now());
}


const lastAuthByKey = new Map();

router.get('/has-token', async (req, res) => {
    const shop = String(req.query.shop || '').toLowerCase().trim();
    const row = await db.Shop.findOne({ where: { shop }, attributes: ['shop'], raw: true });
    res.json({ hasToken: !!row, shop });
});

router.get('/auth', async (req, res) => {
    const { shop, host: hostFromQuery, hmac } = req.query;
    if (!shop || !isValidShopDomain(shop)) {
        return res.status(400).send('Parametro "shop" invalido');
    }
    const shopNorm = shop.toLowerCase();

    // 0) Se veio com hmac (embutido no Admin), primeiro sobe para top-level (sem iniciar OAuth no iframe)
    if (hmac) {
        const safeHost = hostFromQuery || Buffer.from(`${shopNorm}/admin`, 'utf8').toString('base64');
        const cleanUrl = `${APP_URL}/shopify/auth?shop=${encodeURIComponent(shopNorm)}&host=${encodeURIComponent(safeHost)}`;
        const html = renderTopLevelRedirect({ apiKey: API_KEY, host: safeHost, targetUrl: cleanUrl });
        return res.status(200).type('html').send(html);
    }

    // 1) Checa token (idempotência)
    let row = null;
    try {
        row = await db.Shop.findOne({ where: { shop: shopNorm }, attributes: ['accessToken'], raw: true });
    } catch (e) {
        console.error('[AUTH] erro ao checar token (DB):', e?.stack || e);
    }

    if (row?.accessToken) {
        // ATENÇÃO: a partir daqui, nada está no try — se faltar algo, você verá o erro real no log
        const safeHost = hostFromQuery || Buffer.from(`${shopNorm}/admin`, 'utf8').toString('base64');
        const targetUrl = `${APP_URL}/?shop=${shopNorm}&host=${encodeURIComponent(safeHost)}&embedded=1`;

        try {
            if (!APP_URL) throw new Error('APP_URL ausente do .env');
            if (!API_KEY) throw new Error('SHOPIFY_API_KEY ausente do .env');

            const html = renderTopLevelRedirect({ apiKey: API_KEY, host: safeHost, targetUrl });
            return res.status(200).type('html').send(html);
        } catch (e) {
            console.error('[AUTH] erro ao renderTopLevelRedirect:', e?.stack || e);
            // fallback simples se algo falhar ao montar o HTML
            return res
                .status(200)
                .type('html')
                .send(`<meta http-equiv="refresh" content="0;url='${targetUrl}'">`);
        }
    }

    // 2) Anti-duplo clique (3s)
    const key = `${req.ip}|${shopNorm}`, now = Date.now(), last = lastAuthByKey.get(key) || 0;
    if (now - last < 3000) return res.status(429).send('Auth já em andamento');
    lastAuthByKey.set(key, now);

    // 3) Inicia OAuth (fora do iframe)
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('shopify_state', state, { httpOnly: true, sameSite: 'none', secure: true });

    const redirectUri = `${APP_URL}/shopify/auth/callback`;
    const url = new URL(`https://${shopNorm}/admin/oauth/authorize`);
    url.searchParams.set('client_id', API_KEY);
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);

    console.log('Auth redirect_uri =>', redirectUri);
    return res.redirect(url.toString());
});

// /shopify/auth/callback
// /shopify/auth/callback
router.get('/auth/callback', async (req, res) => {
    try {
        console.log('[callback] HIT', req.query);
        const { shop, code, hmac, state, embedded, id_token } = req.query;
        if (!shop || !code || !hmac || !state) return res.status(400).send('Missing params');
        if (!isValidShopDomain(shop)) return res.status(400).send('Invalid shop');
        if (!isValidHmac(req.query)) return res.status(401).send('Invalid HMAC');

        const shopNorm = shop.toLowerCase();
        const host = req.query.host || Buffer.from(`${shopNorm}/admin`, 'utf8').toString('base64');

        // Caso 1) Callback "embedded" (Admin reencenando dentro do iframe):
        // Não exija cookie 'shopify_state' aqui — apenas volte para a raiz embedded.
        if (embedded === '1' || id_token) {
            const html = renderTopLevelRedirect({
                apiKey: API_KEY,
                host,
                targetUrl: `${APP_URL}/?shop=${shopNorm}&host=${encodeURIComponent(host)}&embedded=1`,
            });
            return res.status(200).type('html').send(html);
        }

        // Caso 2) Callback Top-Level (primeira batida verdadeira do OAuth):
        // Aqui sim o cookie/state precisa bater.
        if (!req.cookies || req.cookies.shopify_state !== state) {
            return res.status(401).send('Invalid state');
        }
        res.clearCookie('shopify_state');

        // Se a loja já tem token, não processe de novo.
        const existing = await db.Shop.findOne({
            where: { shop: shopNorm },
            attributes: ['accessToken'],
            raw: true
        });
        if (existing?.accessToken) {
            const html = renderTopLevelRedirect({
                apiKey: API_KEY,
                host,
                targetUrl: `${APP_URL}/?shop=${shopNorm}&host=${encodeURIComponent(host)}&embedded=1`,
            });
            return res.status(200).type('html').send(html);
        }

        // Evite reaproveitar o mesmo "code"
        if (isCodeUsed(code)) {
            const html = renderTopLevelRedirect({
                apiKey: API_KEY,
                host,
                targetUrl: `${APP_URL}/?shop=${shopNorm}&host=${encodeURIComponent(host)}&embedded=1`,
            });
            return res.status(200).type('html').send(html);
        }

        // Troca code -> token
        const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: API_KEY, client_secret: API_SECRET, code }),
        });

        let body = {};
        try { body = await r.json(); } catch { }

        if (!r.ok || !body?.access_token) {
            // Se o code já foi usado / inválido, trate como duplicata benigna
            if (r.status === 400 || r.status === 422) {
                console.warn('[callback] code reuse/invalid; seguindo para raiz embedded', { status: r.status, body });
                const html = renderTopLevelRedirect({
                    apiKey: API_KEY,
                    host,
                    targetUrl: `${APP_URL}/?shop=${shopNorm}&host=${encodeURIComponent(host)}&embedded=1`,
                });
                return res.status(200).type('html').send(html);
            }
            console.error('[callback] Falha token', { status: r.status, body });
            return res.status(502).send('Falha ao obter token da Shopify');
        }

        markCodeUsed(code);
        await db.Shop.upsert({
            shop: shopNorm,
            accessToken: body.access_token,
            scope: body.scope || null
        });

        const html = renderTopLevelRedirect({
            apiKey: API_KEY,
            host,
            targetUrl: `${APP_URL}/?shop=${shopNorm}&host=${encodeURIComponent(host)}&embedded=1`,
        });
        return res.status(200).type('html').send(html);

    } catch (e) {
        console.error('OAuth callback error:', e);
        return res.status(500).send('OAuth error');
    }
});



router.get("/conexao", autenticarShopify, async (req, res) => {
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
