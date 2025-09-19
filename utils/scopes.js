// utils/shopifyScopes.js
const https = require('https');
const AGENT = new https.Agent({ keepAlive: true });

async function getAccessScopesLive(shop, token) {
    const r = await fetch(`https://${shop}/admin/oauth/access_scopes.json`, {
        headers: { 'X-Shopify-Access-Token': token, 'Accept': 'application/json' },
        agent: AGENT,
    });
    if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(`access_scopes ${r.status}: ${t}`);
    }
    const j = await r.json();
    return (j.access_scopes || []).map(s => s.handle);
}
module.exports = { getAccessScopesLive };
