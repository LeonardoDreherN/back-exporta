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
const jwt = require('jsonwebtoken');
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

router.post('/prepare-install', autenticarUsuario, async (req, res) => {
    const shop = String(req.body?.shop || '').toLowerCase().trim();
    if (!shop || !isValidShopDomain(shop)) {
        return res.status(400).json({ erro: 'Domínio da loja inválido' });
    }

    const clienteId = req.clienteId ?? req.usuario?.clienteId;
    if (!clienteId) {
        return res.status(403).json({ erro: 'Cliente não identificado' });
    }

    // Token curto assinado — evita problema de cookie cross-origin (Vercel → Render)
    const bindToken = jwt.sign(
        { clienteId, shop },
        process.env.JWT_SECRET,
        { expiresIn: '10m' }
    );

    const authUrl = `${APP_URL}/shopify/auth?shop=${encodeURIComponent(shop)}&bind_token=${encodeURIComponent(bindToken)}`;
    return res.json({ authUrl });
});

router.get('/auth', async (req, res) => {
    const { shop, hmac, bind_token } = req.query;
    if (!shop || !isValidShopDomain(shop)) return res.status(400).send('Parametro "shop" invalido');
    const shopNorm = shop.toLowerCase();

    if (hmac) {
        const handle = toStoreHandle(shopNorm);
        const safeHost = req.query.host || Buffer.from(`admin.shopify.com/store/${handle}`, 'utf8').toString('base64');

        const cleanUrl = `${APP_URL}/shopify/auth?shop=${encodeURIComponent(shopNorm)}&host=${encodeURIComponent(safeHost)}`;
        return res.redirect(cleanUrl);
    }

    // Verifica bind_token na URL (evita problema de cookie cross-origin Vercel → Render)
    let bindClienteIdFromToken = null;
    if (bind_token) {
        try {
            const decoded = jwt.verify(String(bind_token), process.env.JWT_SECRET);
            if (decoded.clienteId && decoded.shop === shopNorm) {
                bindClienteIdFromToken = String(decoded.clienteId);
                // Seta cookie same-domain para o callback ler normalmente
                res.cookie('bind_cliente_id', bindClienteIdFromToken, {
                    httpOnly: true,
                    sameSite: 'none',
                    secure: true,
                    path: '/shopify',
                    maxAge: 10 * 60 * 1000,
                });
            }
        } catch {
            // token inválido ou expirado — cai no redirect abaixo
        }
    }

    // Sem vínculo via token nem via cookie
    if (!bindClienteIdFromToken && !req.cookies?.bind_cliente_id) {
        // Loja já instalada (tem token): só reabrir o app embedded
        try {
            const existingShop = await db.Shop.findOne({ where: { shop: shopNorm }, attributes: ['accessToken'], raw: true });
            if (existingShop?.accessToken) {
                const handle = toStoreHandle(shopNorm);
                const safeHost = req.query.host || Buffer.from(`admin.shopify.com/store/${handle}`, 'utf8').toString('base64');
                const targetUrl = `${process.env.FRONT_URL}/?shop=${shopNorm}&host=${encodeURIComponent(safeHost)}&embedded=1`;
                return res.redirect(targetUrl);
            }
        } catch { /* continua para fluxo de install */ }

        const installUrl = `${process.env.FRONT_URL}/shopify-install?shop=${encodeURIComponent(shopNorm)}`;
        return res.redirect(installUrl);
    }

    let row = null;
    try {
        row = await db.Shop.findOne({ where: { shop: shopNorm }, attributes: ['accessToken'], raw: true });
    } catch (e) {
        console.error('[AUTH] erro ao checar token (DB):', e?.stack || e);
    }

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
        console.log('[CALLBACK] query:', req.query);
        console.log('[CALLBACK] cookies:', req.cookies);

        const { shop, code, hmac, state } = req.query;
        if (!shop || !code || !hmac || !state) return res.status(400).send('Missing params');
        if (!isValidShopDomain(shop)) return res.status(400).send('Invalid shop');
        if (!isValidHmac(req.query)) return res.status(401).send('Invalid HMAC');

        const shopNorm = shop.toLowerCase();
        const host = req.query.host || Buffer.from(`admin.shopify.com/store/${toStoreHandle(shopNorm)}`, 'utf8').toString('base64');
        const targetUrl = `${process.env.FRONT_URL}/?shop=${shopNorm}&host=${encodeURIComponent(host)}&embedded=1`;

        if (!req.cookies || req.cookies.shopify_state !== state) {
            return res.status(401).send('Invalid state');
        }
        res.clearCookie('shopify_state', { path: '/shopify' });

        if (isCodeUsed(code)) {
            return res.redirect(302, targetUrl);
        }

                const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: API_KEY,
                client_secret: API_SECRET,
                code,
                expiring: 1,
            }),
        });

        let body = {};
        try {
            body = await r.json();
        } catch {}

        console.log('[CALLBACK] token status:', r.status);
        console.log('[CALLBACK] token body:', body);

        if (!r.ok || !body?.access_token) {
            console.error('[CALLBACK] Falha ao obter token', {
                status: r.status,
                body,
            });
            return res.status(502).send('Falha ao obter token da Shopify');
        }

        markCodeUsed(code);

        const expiresAt = body.expires_in
            ? new Date(Date.now() + Number(body.expires_in) * 1000)
            : null;

        try {
            await db.Shop.upsert({
                shop: shopNorm,
                accessToken: body.access_token,
                refreshToken: body.refresh_token || null,
                tokenExpiresAt: expiresAt,
                scope: body.scope || null,
            });

            console.log('[CALLBACK] shop salvo com sucesso:', {
                shop: shopNorm,
                hasAccessToken: !!body.access_token,
                hasRefreshToken: !!body.refresh_token,
                tokenExpiresAt: expiresAt,
            });
        } catch (e) {
            console.error('[CALLBACK] erro ao salvar shop:', e);
            return res.status(500).send('Erro ao salvar token');
        }

        const bindClienteId = req.cookies?.bind_cliente_id;
        if (bindClienteId) {
            await db.InfoShopify.upsert({
                id_cliente: bindClienteId,
                shopDomain: shopNorm,
            });
            res.clearCookie('bind_cliente_id', { path: '/shopify' });

            // Auto-registra carrier e webhook após vincular a conta Intrex
            Promise.all([
                autoRegisterCarrier(shopNorm, body.access_token),
                autoRegisterOrdersWebhook(shopNorm, body.access_token),
            ]).then(([carrierResult, webhookResult]) => {
                console.log('[CALLBACK] auto-register carrier:', carrierResult.ok, carrierResult.userErrors);
                console.log('[CALLBACK] auto-register webhook:', webhookResult.ok, webhookResult.userErrors);
            }).catch(err => {
                console.error('[CALLBACK] auto-register error:', err);
            });
        }

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

router.post('/register-orders-webhook', autenticarUsuario, vincularCliente, async (req, res) => {
    try {
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
          mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
            webhookSubscriptionCreate(
              topic: $topic
              webhookSubscription: {
                callbackUrl: $callbackUrl
                format: JSON
              }
            ) {
              webhookSubscription {
                id
                topic
                callbackUrl
                format
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const variables = {
            topic: 'ORDERS_CREATE',
            callbackUrl: `${process.env.SHOPIFY_APP_URL}/shopify/webhooks/orders-create`
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
        const webhookResp = data?.data?.webhookSubscriptionCreate;
        const userErrors = webhookResp?.userErrors || [];

        return res.json({
            ok: response.ok && userErrors.length === 0,
            shop,
            webhook: webhookResp?.webhookSubscription || null,
            userErrors,
            raw: data
        });
    } catch (e) {
        console.error('[REGISTER ORDERS WEBHOOK ERROR]', e);
        return res.status(500).json({
            ok: false,
            error: e.message
        });
    }
});

async function autoRegisterCarrier(shop, accessToken) {
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
            callbackUrl:
                process.env.SHOPIFY_CARRIER_CALLBACK_URL ||
                'https://back-exporta.onrender.com/shopify/carrier',
            supportsServiceDiscovery: true,
            active: true
        }
    };

    const response = await fetch(`https://${shop}/admin/api/2026-04/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query, variables }),
    });

    const data = await response.json();
    const carrierResp = data?.data?.carrierServiceCreate;
    const userErrors = carrierResp?.userErrors || [];

    console.log('[AUTO REGISTER CARRIER]', JSON.stringify(data, null, 2));

    return {
        ok: response.ok && userErrors.length === 0,
        carrierService: carrierResp?.carrierService || null,
        userErrors,
        raw: data
    };
}

async function autoRegisterOrdersWebhook(shop, accessToken) {
    const query = `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
        webhookSubscriptionCreate(
          topic: $topic
          webhookSubscription: {
            callbackUrl: $callbackUrl
            format: JSON
          }
        ) {
          webhookSubscription {
            id
            topic
            callbackUrl
            format
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
        topic: 'ORDERS_CREATE',
        callbackUrl: `${process.env.SHOPIFY_APP_URL}/shopify/webhooks/orders-create`
    };

    const response = await fetch(`https://${shop}/admin/api/2026-04/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query, variables }),
    });

    const data = await response.json();
    const webhookResp = data?.data?.webhookSubscriptionCreate;
    const userErrors = webhookResp?.userErrors || [];

    console.log('[AUTO REGISTER WEBHOOK]', JSON.stringify(data, null, 2));

    return {
        ok: response.ok && userErrors.length === 0,
        webhook: webhookResp?.webhookSubscription || null,
        userErrors,
        raw: data
    };
}

router.get('/app-status', autenticarUsuario, async (req, res) => {
    try {
        const shopFromQuery = String(req.query?.shop || '').toLowerCase().trim();
        const shopFromSession = String(req.shopDomain || '').toLowerCase().trim();

        const shop = shopFromQuery || shopFromSession;

        if (!shop) {
            return res.status(400).json({
                ok: false,
                erro: 'Loja não identificada',
            });
        }

        const shopRow = await db.Shop.findOne({
            where: { shop },
            attributes: ['shop', 'accessToken'],
            raw: true,
        });

        const infoRow = await db.InfoShopify.findOne({
            where: { shopDomain: shop },
            attributes: ['id_cliente', 'shopDomain'],
            raw: true,
        });

        let hasCarrier = false;
        let hasOrdersWebhook = false;

        if (shopRow?.accessToken) {
            const query = `
              query AppStatusCheck {
                deliveryCarrierServices(first: 20) {
                  nodes {
                    id
                    name
                    active
                    callbackUrl
                  }
                }
                webhookSubscriptions(first: 50) {
                  nodes {
                    id
                    topic
                    callbackUrl
                  }
                }
              }
            `;

            const response = await fetch(`https://${shop}/admin/api/2026-04/graphql.json`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': shopRow.accessToken,
                },
                body: JSON.stringify({ query }),
            });

            const data = await response.json();

            const carriers = data?.data?.deliveryCarrierServices?.nodes || [];
            const webhooks = data?.data?.webhookSubscriptions?.nodes || [];

            hasCarrier = carriers.some((c) =>
                String(c?.name || '').toLowerCase().includes('intrex')
            );

            hasOrdersWebhook = webhooks.some((w) =>
                String(w?.topic || '').toUpperCase() === 'ORDERS_CREATE'
            );
        }

        return res.json({
            ok: true,
            shop,
            hasToken: !!shopRow?.accessToken,
            hasInfoShopify: !!infoRow?.id_cliente,
            hasCarrier,
            hasOrdersWebhook,
            intrexConnected: !!infoRow?.id_cliente,
        });
    } catch (e) {
        console.error('[APP STATUS ERROR]', e);
        return res.status(500).json({
            ok: false,
            erro: 'Falha ao consultar status do app',
        });
    }
});

module.exports = router;
