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

        const limit = Math.min(Number(req.query.limite) || 50, 250);
        const pageInfo = req.query.infoPagina ? String(req.query.infoPagina) : undefined;

        // 👉 Precisamos desses campos no REST:
        // - product_category (traz product_taxonomy_node_id)
        // - harmonized_system_code (HS no produto, fallback)
        // - variants (para extrair o HS code das variantes)
        const fields =
            (req.query.fields && String(req.query.fields)) ||
            [
                'id',
                'title',
                'handle',
                'status',
                'updated_at',
                'product_type',
                'product_category',
                'harmonized_system_code',
                'variants'
            ].join(',');

        const params = new URLSearchParams({ limit: String(limit), fields });
        if (pageInfo) params.set('page_info', pageInfo);

        const url = `https://${shop}/admin/api/${apiVersion}/products.json?${params.toString()}`;

        // ===== REST listagem =====
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
                erro: 'Erro ao consultar produtos na Shopify (REST)',
                detalhes: body?.errors || body,
            });
        }

        const lista = Array.isArray(body.products) ? body.products : [];

        // ===== Coletar IDs de taxonomia retornados pelo REST =====
        const taxonomyIds = new Set(); // GIDs de ProductTaxonomyNode
        for (const p of lista) {
            const rawId =
                p?.product_category?.product_taxonomy_node_id ??
                p?.category?.product_taxonomy_node_id ?? // (edge antigo)
                null;

            if (!rawId) continue;

            const gid = String(rawId).startsWith('gid://shopify/')
                ? String(rawId)
                : `gid://shopify/ProductTaxonomyNode/${String(rawId).replace(/\D+/g, '')}`;

            taxonomyIds.add(gid);
        }

        // ===== GraphQL: traduzir IDs -> fullName (1 chamada por página) =====
        const taxonomyMap = new Map(); // gid -> fullName
        if (taxonomyIds.size) {
            const Q_TAX_NODES = `
        query($ids:[ID!]!){
          nodes(ids:$ids){
            ... on ProductTaxonomyNode { id fullName }
          }
        }
      `;
            const ac2 = new AbortController();
            const to2 = setTimeout(() => ac2.abort(), 15000);
            try {
                const gqlResp = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
                    method: 'POST',
                    headers: {
                        'X-Shopify-Access-Token': token,
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ query: Q_TAX_NODES, variables: { ids: Array.from(taxonomyIds) } }),
                    agent: KEEPALIVE_AGENT,
                    signal: ac2.signal,
                });
                const gqlBody = await gqlResp.json().catch(() => ({}));
                if (!gqlResp.ok || gqlBody.errors) {
                    console.warn('⚠️ Falha GraphQL taxonomy nodes:', gqlBody.errors || gqlBody);
                } else {
                    for (const n of gqlBody.data?.nodes || []) {
                        if (n && n.id) taxonomyMap.set(n.id, n.fullName || null);
                    }
                }
            } finally {
                clearTimeout(to2);
            }
        }

        // ===== Montar saída no shape que seu front espera =====
        const produtos = lista.map(p => {
            const rawTaxId =
                p?.product_category?.product_taxonomy_node_id ??
                p?.category?.product_taxonomy_node_id ??
                null;

            const taxGid = rawTaxId
                ? (String(rawTaxId).startsWith('gid://shopify/')
                    ? String(rawTaxId)
                    : `gid://shopify/ProductTaxonomyNode/${String(rawTaxId).replace(/\D+/g, '')}`)
                : null;

            const fullName = taxGid ? taxonomyMap.get(taxGid) || null : null;

            const variants = (p.variants || []).map(v => ({
                id: v.id,
                sku: v.sku ?? null,
                price: v.price ?? null,
                // 👇 convertemos do REST (snake_case) para camelCase do front
                harmonizedSystemCode: v.harmonized_system_code || null,
            }));

            return {
                id: p.id,
                title: p.title,
                handle: p.handle,
                status: p.status ?? null,
                updated_at: p.updated_at ?? null,
                product_type: p.product_type ?? null,

                // 👉 Dois campos para o seu getCategoria() fazer fallback
                productCategory: taxGid ? { productTaxonomyNode: { id: taxGid, fullName } } : null,
                standardizedProductType: taxGid ? { productTaxonomyNode: { id: taxGid, fullName } } : null,

                // 👉 HS no produto como fallback (principal é nas variantes)
                harmonizedSystemCode: p?.harmonized_system_code || null,

                variants
            };
        });

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

module.exports = { verProdutosLojaShopify, registrarLojaShopify, resolveLojaEToken };
