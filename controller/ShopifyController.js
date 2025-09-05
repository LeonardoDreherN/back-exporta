// controller/ShopifyController.js
const https = require('https');

// Polyfill fetch (Node < 18)
if (typeof fetch === 'undefined') {
    global.fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
}

const API_VERSION = process.env.API_VERSION || '2025-07';
const KEEPALIVE_AGENT = new https.Agent({ keepAlive: true, keepAliveMsecs: 10_000, maxSockets: 50 });

function proximaPaginaDoLink(link) {
    if (!link) return null;
    const m = link.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/i);
    return m ? decodeURIComponent(m[1]) : null;
}

const verProdutosLojaShopify = async (req, res) => {
    try {
        // middlewares comLoja/garantirInstalada devem preencher:
        if (!req.shopDomain || !req.shopToken) {
            return res.status(401).json({ erro: 'Loja nao autenticada/instalada' });
        }

        const shop = req.shopDomain;
        const token = req.shopToken;

        // Defaults LEVES (evita payload gigante)
        const limit = Math.min(Number(req.query.limite) || 50, 250);
        const pageInfo = req.query.infoPagina ? String(req.query.infoPagina) : undefined;
        const fields = (req.query.fields && String(req.query.fields))
            || ['id', 'title', 'handle', 'product_type', 'status', 'updated_at', 'variants'].join(',');

        // Monta params REST (Shopify espera limit/page_info/fields)
        const params = new URLSearchParams({ limit: String(limit), fields });
        if (pageInfo) params.set('page_info', pageInfo);

        const url = `https://${shop}/admin/api/${API_VERSION}/products.json?${params.toString()}`;

        // Timeout + keep-alive
        const ac = new AbortController();
        const timeoutMs = Number(process.env.SHOPIFY_TIMEOUT_MS) || 15000;
        const to = setTimeout(() => ac.abort(), timeoutMs);

        const resp = await fetch(url, {
            headers: {
                'X-Shopify-Access-Token': token,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            agent: KEEPALIVE_AGENT,   // funciona no node-fetch
            signal: ac.signal,
        }).finally(() => clearTimeout(to));

        const body = await resp.json().catch(() => ({}));

        if (!resp.ok) {
            return res.status(resp.status).json({
                erro: 'Erro ao consultar produtos na Shopify',
                detalhes: body?.errors || body,
            });
        }

        const produtos = Array.isArray(body.products) ? body.products : []

        const produto = produtos.map(p => ({
            id: p.id,
            title: p.title,
            handle: p.handle,
            status: p.status,
            updated_at: p.updated_at,
            product_type: p.product_type,
            variants: (p.variants || []).map(v => ({
                id: v.id,
                sku: v.sku,
                weight: v.weight,          // número
                unit: v.weight_unit,       // 'g' | 'kg' | 'oz' | 'lb'
                grams: v.grams
            }))
        }))


        const link = resp.headers.get('link') || resp.headers.get('Link');

        return res.status(200).json(produtos);
    } catch (err) {
        const isAbort = String(err?.name || '').toLowerCase().includes('abort');
        if (isAbort) return res.status(504).json({ erro: 'Timeout consultando Shopify' });

        console.error('❌ verProdutosLojaShopify:', err);
        return res.status(500).json({ erro: 'Erro interno', detalhes: err.message });
    }
};

module.exports = { verProdutosLojaShopify };
