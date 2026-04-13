function toStoreHandle(input) {
    if (!input) return null;
    const s = String(input).trim();

    // base64 → texto (quando vem "host")
    let decoded = null;
    if (/^[A-Za-z0-9+/=]+$/.test(s) && s.length % 4 === 0) {
        try {
            const tmp = Buffer.from(s, 'base64').toString('utf8');
            if (/shopify\.com|\/store\//i.test(tmp)) decoded = tmp;
        } catch { }
    }
    const str = decoded || s;

    let m = str.match(/(?:https?:\/\/)?([a-z0-9][a-z0-9-]*)\.myshopify\.com/i);
    if (m) return m[1].toLowerCase();
    m = str.match(/admin\.shopify\.com\/store\/([a-z0-9-]+)/i);
    if (m) return m[1].toLowerCase();
    if (/^[a-z0-9][a-z0-9-]*$/i.test(str)) return str.toLowerCase();
    return null;
}


function renderTopLevelRedirect({ apiKey, host, targetUrl }) {
    return `
<!DOCTYPE html><html><head><meta charset="utf-8">
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<script>
document.addEventListener('DOMContentLoaded', function() {
  var AB = window['app-bridge'];
  var app = AB.createApp({ apiKey: '${apiKey}', host: '${host}', forceRedirect: true });
  var Redirect = AB.actions.Redirect;
  try {
    Redirect.create(app).dispatch(Redirect.Action.REMOTE, '${targetUrl}');
  } catch (e) {
    (window.top || window).location.href = '${targetUrl}';
  }
});
</script></head><body></body></html>`;
}




const express = require('express');
const crypto = require('crypto');
const db = require('../models');
const { autenticarUsuario, vincularCliente } = require('../middleware/auth');
const { uploadOrdersMinimal } = require('../controller/pedidosMinimalController');
const { uploadOrder } = require('../middleware/shopifyAuth');
const { findCustomerFromCsv } = require('../controller/customerController');
const { importPedidosInternal } = require('../controller/PedidoImportController');
require('dotenv').config();

const router = express.Router();

const APP_URL = (process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
const API_KEY = process.env.SHOPIFY_API_KEY;
const API_SECRET = process.env.SHOPIFY_API_SECRET;
const RAW_SCOPES = String(process.env.SHOPIFY_API_SCOPES || '');
const SCOPES = RAW_SCOPES
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .join(',');

if (!SCOPES) {
    console.error('[SHOPIFY] Nenhum escopo configurado! Defina SHOPIFY_API_SCOPES no .env');
}

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
    } catch { return false; }
}

const usedAuthCodes = new Map();
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
function isCodeUsed(code) {
    const now = Date.now();
    for (const [c, t] of usedAuthCodes) if (now - t > AUTH_CODE_TTL_MS) usedAuthCodes.delete(c);
    return usedAuthCodes.has(code);
}
function markCodeUsed(code) { usedAuthCodes.set(code, Date.now()); }

const lastAuthByKey = new Map();

router.get('/has-token', async (req, res) => {
    const shop = String(req.query.shop || '').toLowerCase().trim();
    const row = await db.Shop.findOne({ where: { shop }, attributes: ['shop'], raw: true });
    res.json({ hasToken: !!row, shop });
});

router.get('/auth', async (req, res) => {
    const { shop, host: hostFromQuery, hmac } = req.query;
    if (!shop || !isValidShopDomain(shop)) return res.status(400).send('Parametro "shop" invalido');
    const shopNorm = shop.toLowerCase();

    // **NOVO**: se o usuário já estiver autenticado na sua plataforma, guarde o vínculo para o callback
    if (req.clienteId) {
        res.cookie('bind_cliente_id', String(req.clienteId), {
            httpOnly: true,
            sameSite: 'none',
            secure: process.env.NODE_ENV !== 'development',
            path: '/shopify'
        });
    }

    // Se veio do Admin embedded (com hmac), apenas sobe para top-level
    if (hmac) {
        const handle = toStoreHandle(shopNorm);
        const safeHost = req.query.host || Buffer.from(`admin.shopify.com/store/${handle}`, 'utf8').toString('base64');

        const cleanUrl = `${APP_URL}/shopify/auth?shop=${encodeURIComponent(shopNorm)}&host=${encodeURIComponent(safeHost)}`;
        const html = renderTopLevelRedirect({ apiKey: API_KEY, host: safeHost, targetUrl: cleanUrl });
        return res.status(200).type('html').send(html);
    }

    // Idempotência: se já tem token, só redireciona para o app
    let row = null;
    try {
        row = await db.Shop.findOne({ where: { shop: shopNorm }, attributes: ['accessToken'], raw: true });
    } catch (e) {
        console.error('[AUTH] erro ao checar token (DB):', e?.stack || e);
    }

   /* if (row?.accessToken) {
        const handle = toStoreHandle(shopNorm);
        const safeHost = req.query.host || Buffer.from(`admin.shopify.com/store/${handle}`, 'utf8').toString('base64');

        const targetUrl = `${APP_URL}/?shop=${shopNorm}&host=${encodeURIComponent(safeHost)}&embedded=1`;
        try {
            const html = renderTopLevelRedirect({ apiKey: API_KEY, host: safeHost, targetUrl });
            return res.status(200).type('html').send(html);
        } catch (e) {
            console.error('[AUTH] erro ao renderTopLevelRedirect:', e?.stack || e);
            return res.status(200).type('html').send(`<meta http-equiv="refresh" content="0;url='${targetUrl}'">`);
        }
    } */

    // Anti-duplo clique (3s)
    const key = `${req.ip}|${shopNorm}`, now = Date.now(), last = lastAuthByKey.get(key) || 0;
    if (now - last < 3000) return res.status(429).send('Auth já em andamento');
    lastAuthByKey.set(key, now);

    // Inicia OAuth
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('shopify_state', state, {
        httpOnly: true,
        sameSite: 'none',
        secure: process.env.NODE_ENV !== 'development',
        path: '/shopify'
    });

    const redirectUri = new URL('/shopify/auth/callback', APP_URL).toString();
    const url = new URL(`https://${shopNorm}/admin/oauth/authorize`);
    url.searchParams.set('client_id', API_KEY);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    if (!SCOPES) {
        console.error('[SHOPIFY] SCOPES vazios! Verifique SHOPIFY_API_SCOPES no .env');
        return res.status(500).send('App mal configurado: SCOPES ausentes');
    }
    url.searchParams.set('scope', SCOPES);


    return res.redirect(url.toString());
});

router.get('/auth/callback', async (req, res) => {
    try {
        const { shop, code, hmac, state, embedded, id_token } = req.query;
        if (!shop || !code || !hmac || !state) return res.status(400).send('Missing params');
        if (!isValidShopDomain(shop)) return res.status(400).send('Invalid shop');
        if (!isValidHmac(req.query)) return res.status(401).send('Invalid HMAC');

        const shopNorm = shop.toLowerCase();
        const host = req.query.host || Buffer.from(`admin.shopify.com/store/${toStoreHandle(shopNorm)}`, 'utf8').toString('base64');
        const targetUrl = `${APP_URL}/?shop=${shopNorm}&host=${encodeURIComponent(host)}&embedded=1`;

        // Se o callback veio embedded, apenas redirecione para a raiz do app
        if (embedded === '1' || id_token) {
            return res.redirect(302, targetUrl);
        }

        if (!req.cookies || req.cookies.shopify_state !== state) return res.status(401).send('Invalid state');
        res.clearCookie('shopify_state', { path: '/shopify' });

        // Se já existe token, só volta para o app
       /* const existing = await db.Shop.findOne({
            where: { shop: shopNorm },
            attributes: ['accessToken'],
            raw: true
        });
        if (existing?.accessToken) {
            return res.redirect(302, targetUrl);
        } */

        // Evita reuso do code
        if (isCodeUsed(code)) {
            return res.redirect(302, targetUrl);
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
            // Se for reuso/invalid code, siga para o app (o Admin vai reentrar e ficar ok)
            if (r.status === 400 || r.status === 422) {
                return res.redirect(302, targetUrl);
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

        // Vincula loja ao cliente (se houver cookie)
        const bindClienteId = req.cookies?.bind_cliente_id;
        if (bindClienteId) {
            await db.InfoShopify.upsert({
                id_cliente: bindClienteId,
                shopDomain: shopNorm
            });
            res.clearCookie('bind_cliente_id', { path: '/shopify' });
        }

        // Final: sempre redirecione para a raiz embed do app
        return res.redirect(302, targetUrl);

    } catch (e) {
        console.error('OAuth callback error:', e);
        return res.status(500).send('OAuth error');
    }
});

router.get("/conexao", autenticarUsuario, async (req, res) => {
    try {
        const clienteId = req.clienteId ?? res.locals?.clienteId;
        if (!clienteId) return res.json({ connected: false, loja: null, reason: "unauthenticated" });

        const info = await db.InfoShopify.findOne({
            where: { id_cliente: clienteId },
            attributes: ["shopDomain"], order: [["updatedAt", "DESC"]], raw: true,
        });

        if (!info?.shopDomain) return res.json({ connected: false, loja: null });

        const shopRow = await db.Shop.findOne({
            where: { shop: info.shopDomain }, attributes: ["accessToken"], raw: true,
        });

        return res.json({
            // connected: !!shopRow?.accessToken,
            loja: { shopDomain: info.shopDomain },
        });
    } catch (e) {
        console.error("Erro em GET /shopify/conexao:", e);
        return res.status(500).json({ erro: "Falha ao verificar conexão" });
    }
});


router.post(
    '/upload-minimal',
    autenticarUsuario,          // descobre o cliente pelo token
    vincularCliente,            // seta req.clienteId
    uploadOrder.fields([{ name: 'file' }, { name: 'sku_master' }]),
    async (req, res) => {
        // ... parse do CSV (uploadOrdersMinimal retornando linhas) ...
        // const { importPedidosInternal } = require('../controller/PedidoImportController');
        // const parsed = await uploadOrdersMinimal(req, res, /*returnOnly*/ true);
        // const linhas = parsed?.linhas || [];
        // const imported = await importPedidosInternal(req.clienteId, linhas);
        // return res.json({ ok: true, linhas_count: linhas.length, imported });

        try {
            // agora uploadOrdersMinimal só retorna dados (não escreve em res)
            const parsed = await uploadOrdersMinimal(req, res, /* returnOnly */ true);
            const linhas = parsed?.linhas || [];

            // se quiser já importar:
            const { importPedidosInternal } = require('../controller/PedidoImportController');
            const imported = await importPedidosInternal(req.clienteId, linhas);


            // >>> única resposta do request <<<
            return res.json({ ok: true, linhas, linhas_count: linhas.length, imported });
        } catch (e) {
            // >>> única resposta de erro <<<
            console.error('[upload-minimal] erro:', e);
            return res.status(400).json({ ok: false, error: e?.message || 'falha ao processar CSV' });
        }
    }
);

router.post(
    '/find',
    uploadOrder.fields([{ name: 'file' }]),
    findCustomerFromCsv
);

router.post('/register-carrier', autenticarUsuario, vincularCliente, async (req, res) => {
    try {
        console.log('[REGISTER CARRIER] body:', req.body);

        const shop = String(req.body?.shop || '').toLowerCase().trim();

        if (!shop) {
            return res.status(400).json({ ok: false, error: 'shop é obrigatório' });
        }

        const row = await db.Shop.findOne({
            where: { shop },
            attributes: ['shop', 'accessToken'],
            raw: true,
        });

        if (!row?.accessToken) {
            return res.status(404).json({ ok: false, error: 'Loja sem token salvo' });
        }

        const query = `
          mutation carrierServiceCreate($input: DeliveryCarrierServiceCreateInput!) {
            carrierServiceCreate(input: $input) {
              carrierService {
                id
                name
                active
                callbackUrl
                supportsServiceDiscovery
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const variables = {
            input: {
                name: 'Intrex Shipping',
                callbackUrl: process.env.SHOPIFY_CARRIER_CALLBACK_URL || 'https://back-exporta.onrender.com/shopify/carrier',
                supportsServiceDiscovery: true,
                active: true
            }
        };

        const response = await fetch(`https://${shop}/admin/api/2026-04/graphql.json`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': row.accessToken,
            },
            body: JSON.stringify({ query, variables }),
        });

        const data = await response.json();
        const carrierResp = data?.data?.carrierServiceCreate;
        const userErrors = carrierResp?.userErrors || [];

        console.log('[REGISTER CARRIER] response:', JSON.stringify(data, null, 2));

        return res.json({
            ok: response.ok && userErrors.length === 0,
            shop,
            carrierService: carrierResp?.carrierService || null,
            userErrors,
            raw: data
        });
    } catch (e) {
        console.error('[REGISTER CARRIER ERROR]', e);
        return res.status(500).json({
            ok: false,
            error: e.message
        });
    }
});
module.exports = router;
