// utils/shopifyScopes.js
const https = require('https');
const KEEPALIVE_AGENT = new https.Agent({ keepAlive: true });

async function getAccessScopesLive(shop, token) {
    const r = await fetch(`https://${shop}/admin/oauth/access_scopes.json`, {
        headers: { 'X-Shopify-Access-Token': token, 'Accept': 'application/json' },
        agent: KEEPALIVE_AGENT,
    });
    if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(`Falha ao ler access_scopes (${r.status}): ${t}`);
    }
    const j = await r.json();
    // retorno: { access_scopes: [ { handle: 'read_products' }, ... ] }
    return (j.access_scopes || []).map(s => s.handle);
}
module.exports = { getAccessScopesLive };
