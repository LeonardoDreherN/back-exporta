const db = require('../../models');

const API_KEY = process.env.SHOPIFY_API_KEY;
const API_SECRET = process.env.SHOPIFY_API_SECRET;

// Shopify expiring offline tokens duram 1h; renova um pouco antes de vencer.
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

async function refreshAccessToken(shopDomain, refreshToken) {
    const r = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: API_KEY,
            client_secret: API_SECRET,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }),
    });

    let body = {};
    try {
        body = await r.json();
    } catch {}

    if (!r.ok || !body?.access_token) {
        throw new Error(`Falha ao renovar token Shopify de ${shopDomain}: HTTP ${r.status}`);
    }

    const expiresAt = body.expires_in
        ? new Date(Date.now() + Number(body.expires_in) * 1000)
        : null;

    const updateFields = {
        accessToken: body.access_token,
        refreshToken: body.refresh_token || refreshToken,
        tokenExpiresAt: expiresAt,
    };
    if (body.scope) updateFields.scope = body.scope;

    await db.Shop.update(updateFields, { where: { shop: shopDomain } });

    console.log(`[SHOPIFY OAUTH] Token de ${shopDomain} renovado, expira em ${expiresAt}`);
    return body.access_token;
}

/**
 * Retorna um accessToken válido para a loja, renovando via refreshToken
 * automaticamente quando o token salvo está vencido ou perto de vencer.
 * Lojas com token offline "clássico" (sem tokenExpiresAt) retornam o token direto.
 */
async function getValidAccessToken(shopDomain) {
    const row = await db.Shop.findOne({ where: { shop: shopDomain }, raw: true });
    if (!row?.accessToken) return null;

    const expiresAtMs = row.tokenExpiresAt ? new Date(row.tokenExpiresAt).getTime() : null;
    const isExpiring = expiresAtMs != null && expiresAtMs - Date.now() < EXPIRY_BUFFER_MS;

    if (!isExpiring) return row.accessToken;

    if (!row.refreshToken) {
        console.warn(`[SHOPIFY OAUTH] Token de ${shopDomain} vencido e sem refreshToken salvo.`);
        return row.accessToken;
    }

    try {
        return await refreshAccessToken(shopDomain, row.refreshToken);
    } catch (err) {
        console.error(`[SHOPIFY OAUTH] Falha ao renovar token de ${shopDomain}:`, err.message);
        return row.accessToken;
    }
}

module.exports = { getValidAccessToken };
