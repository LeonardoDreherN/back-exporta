// controller/ShopifyController.js
const https = require('https');
const db = require("../models/index.js");
const { norm } = require('../utils/norm.js');
const { getAccessTokenForShop } = require('../middleware/shopifyAuth.js');
const { Op } = require('sequelize');
const APP_URL = (process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
const API_VERSION = process.env.SHOPIFY_VERSION || "2025-07";



// Polyfill fetch (Node < 18)
if (typeof fetch === 'undefined') {
    global.fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
}

const KEEPALIVE_AGENT = new https.Agent({ keepAlive: true, keepAliveMsecs: 10_000, maxSockets: 50 });

function proximaPaginaDoLink(link) {
    if (!link) return null;
    const m = link.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/i);
    return m ? decodeURIComponent(m[1]) : null;
}

// async function resolveShopRow(req) {
//     const clienteId = req.clienteId ?? req?.res?.locals?.clienteId ?? req?.res?.locals?.clienteId;
//     if (!clienteId) {
//         const err = new Error('Cliente não autenticado');
//         err.http = 401;
//         throw err;
//     }

//     const total = await db.InfoShopify.count({ where: { id_cliente: clienteId } });

//     // Se o middleware já preencheu e não há ambiguidade, aproveite
//     if (req.shopDomain && total <= 1) {
//         const row = await db.InfoShopify.findOne({
//             where: { id_cliente: clienteId, shopDomain: String(req.shopDomain).toLowerCase() },
//             attributes: ['shopDomain', 'apiVersion', 'shopifyApiSecret'],
//             raw: true,
//         });
//         if (row) return row;
//         // se não achou, continua fluxo abaixo
//     }

//     // Quando houver múltiplas lojas, exija ?shop=...
//     let candidate = null;
//     if (req.query?.shop) {
//         try { candidate = norm(req.query.shop); } catch (e) {
//             const err = new Error(e.message || 'shop inválido');
//             err.http = 400;
//             throw err;
//         }
//     } else if (total > 1) {
//         const lojas = await db.InfoShopify.findAll({
//             where: { id_cliente: clienteId },
//             attributes: ['shopDomain'],
//             raw: true
//         });
//         const dica = lojas.length ? ` Ex.: ?shop=${lojas[0].shopDomain}` : '';
//         const err = new Error('Sua conta possui múltiplas lojas; informe o parâmetro ?shop=loja.myshopify.com.' + dica);
//         err.http = 400;
//         throw err;
//     }

//     if (candidate) {
//         // Match canônico
//         const row = await db.InfoShopify.findOne({
//             where: { id_cliente: clienteId, shopDomain: candidate },
//             attributes: ['shopDomain', 'apiVersion', 'shopifyApiSecret'],
//             raw: true,
//         });
//         if (row) return row;

//         // Pequenos fallbacks para registros antigos "sujos"
//         const fallback = await db.InfoShopify.findOne({
//             where: {
//                 id_cliente: clienteId,
//                 [Op.or]: [
//                     { shopDomain: `https://${candidate}` },
//                     { shopDomain: `${candidate}/` },
//                     { shopDomain: candidate.toUpperCase() },
//                 ],
//             },
//             attributes: ['shopDomain', 'apiVersion', 'shopifyApiSecret'],
//             raw: true,
//         });
//         if (fallback) return fallback;

//         const err = new Error('Esta loja não pertence à sua conta (ou não está cadastrada com este domínio).');
//         err.http = 403;
//         throw err;
//     }

//     // Apenas 1 loja => use-a
//     const unica = await db.InfoShopify.findOne({
//         where: { id_cliente: clienteId },
//         attributes: ['shopDomain', 'apiVersion', 'shopifyApiSecret'],
//         order: [['createdAt', 'DESC']],
//         raw: true,
//     });
//     if (!unica) {
//         const err = new Error('Cliente não possui loja conectada');
//         err.http = 404;
//         throw err;
//     }
//     return unica;
// }

async function resolveLojaEToken(req) {
    const clienteId = req.clienteId ?? req?.res?.locals?.clienteId;
    if (!clienteId) {
        const err = new Error('Cliente não autenticado');
        err.http = 401;
        throw err;
    }

    const total = await db.InfoShopify.count({ where: { id_cliente: clienteId } });

    // Se houver várias lojas, exija ?shop=...
    let candidate = null;
    if (req.query?.shop) {
        try { candidate = norm(req.query.shop); } catch (e) {
            const err = new Error(e.message || 'shop inválido');
            err.http = 400;
            throw err;
        }
    } else if (total > 1) {
        const lojas = await db.InfoShopify.findAll({
            where: { id_cliente: clienteId },
            attributes: ['shopDomain'],
            raw: true
        });
        const dica = lojas.length ? ` Ex.: ?shop=${lojas[0].shopDomain}` : '';
        const err = new Error('Sua conta possui múltiplas lojas; informe ?shop=loja.myshopify.com.' + dica);
        err.http = 400;
        throw err;
    }

    // Seleciona a linha canônica da InfoShopifies
    let infoRow;
    if (candidate) {
        infoRow = await db.InfoShopify.findOne({
            where: { id_cliente: clienteId, shopDomain: candidate },
            attributes: ['shopDomain', 'apiVersion'],
            raw: true
        });
        if (!infoRow) {
            // pequenos fallbacks p/ registros antigos “sujos”
            infoRow = await db.InfoShopify.findOne({
                where: {
                    id_cliente: clienteId,
                    [Op.or]: [
                        { shopDomain: `https://${candidate}` },
                        { shopDomain: `${candidate}/` },
                        { shopDomain: candidate.toUpperCase() },
                    ],
                },
                attributes: ['shopDomain', 'apiVersion'],
                raw: true
            });
            if (!infoRow) {
                const err = new Error('Esta loja não pertence à sua conta (ou não está cadastrada).');
                err.http = 403;
                throw err;
            }
        }
    } else {
        infoRow = await db.InfoShopify.findOne({
            where: { id_cliente: clienteId },
            attributes: ['shopDomain', 'apiVersion'],
            order: [['createdAt', 'DESC']],
            raw: true
        });
        if (!infoRow) {
            const err = new Error('Cliente não possui loja conectada');
            err.http = 404;
            throw err;
        }
    }

    const shop = norm(infoRow.shopDomain); // garante canônico
    const { token, scope } = await getAccessTokenForShop(shop);

    if (!token) {
        const err = new Error('Token de acesso ausente para esta loja. Reinstale o app para gerar o token.');
        err.http = 401;
        throw err;
    }

    const apiVersion = req.apiVersion || infoRow.apiVersion || "2025-07";
    return { shop, token, apiVersion, scope };
}

const verProdutosLojaShopify = async (req, res) => {
    try {
        const { shop, token, apiVersion } = await resolveLojaEToken(req);

        // Defaults (evitar payload gigantes)
        const limit = Math.min(Number(req.query.limite) || 50, 250);
        const pageInfo = req.query.infoPagina ? String(req.query.infoPagina) : undefined;
        const fields = (req.query.fields && String(req.query.fields))
            || ['id', 'title', 'product_type', 'status', 'updated_at', 'variants'].join(',');

        const params = new URLSearchParams({ limit: String(limit), fields });
        if (pageInfo) params.set('page_info', pageInfo);

        const url = `https://${shop}/admin/api/${apiVersion}/products.json?${params.toString()}`;

        // Timeout + keep-alive
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), 15000);

        const resp = await fetch(url, {
            headers: {
                'X-Shopify-Access-Token': token,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            agent: KEEPALIVE_AGENT,
            signal: ac.signal,
        }).finally(() => clearTimeout(to));

        const body = await resp.json().catch(() => ({}));

        if (!resp.ok) {
            return res.status(resp.status).json({
                erro: 'Erro ao consultar produtos na Shopify',
                detalhes: body?.errors || body,
            });
        }

        const lista = Array.isArray(body.products) ? body.products : [];
        const produtos = lista.map(p => ({
            id: p.id,
            title: p.title,
            status: p.status,
            product_type: p.product_type ?? null,
            variants: (p.variants || []).map(v => ({
                id: v.id,
                sku: v.sku,
                weight: v.weight,
                weight_unit: v.weight_unit,
                grams: v.grams,
                price: v.price,
            }))
        }));

        const link = resp.headers.get('link') || resp.headers.get('Link');
        const nextPage = proximaPaginaDoLink(link);

        return res.status(200).json({ produtos, nextPage, loja: shop });
    } catch (err) {
        const isAbort = String(err?.name || '').toLowerCase().includes('abort');
        if (isAbort) return res.status(504).json({ erro: 'Timeout consultando Shopify' });
        const http = err?.http || 500;
        if (http !== 500) return res.status(http).json({ erro: err.message });
        console.error('❌ verProdutosLojaShopify:', err);
        return res.status(500).json({ erro: 'Erro interno', detalhes: err.message });
    }
};


//FORM INFO SHOPIFY

const registrarLojaShopify = async (req, res) => {

    const clienteId = req.clienteId ?? res.locals?.clienteId;
    if (!clienteId) return res.status(401).json({ erro: 'Cliente nao autenticado!' });

    try {
        const raw = String(req.body?.shopDomain || '').trim().toLowerCase();
        let shopDomain;
        try {
            shopDomain = norm(raw); // garante algo tipo "minha-loja.myshopify.com"
        } catch (e) {
            return res.status(400).json({ erro: e?.message || 'shopDomain inválido' });
        }
        if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain)) {
            return res.status(400).json({ erro: 'Domínio inválido (ex.: minha-loja.myshopify.com)' });
        }

        const existente = await db.InfoShopify.findOne({
            where: { shopDomain },
            attributes: ['id', 'id_cliente', 'shopDomain', 'updatedAt'],
            raw: true,
        });

        const nextAuthUrl = `${APP_URL}/shopify/auth?shop=${encodeURIComponent(shopDomain)}`;

        if (existente) {
            if (existente.id_cliente === clienteId) {
                // idempotente
                return res.status(200).json({
                    ok: true,
                    mensagem: 'Loja já conectada a este cliente',
                    loja: existente,
                    nextAuthUrl,
                });
            }
            return res.status(409).json({
                erro: 'Loja já conectada em outra conta',
                loja: { id: existente.id, shopDomain: existente.shopDomain },
            });
        }

        const criado = await db.InfoShopify.create({
            id_cliente: clienteId,
            shopDomain,
            apiVersion: API_VERSION,
        });

        return res.status(201).json({
            ok: true,
            mensagem: 'Loja conectada',
            loja: {
                id: criado.id,
                shopDomain: criado.shopDomain,
                id_cliente: criado.id_cliente,
            },
            nextAuthUrl,
        });
    } catch (err) {
        console.error('[registrarLojaShopify] erro:', err);
        return res.status(500).json({ erro: 'Falha ao registrar loja' });
    }
}

module.exports = { verProdutosLojaShopify, registrarLojaShopify };
