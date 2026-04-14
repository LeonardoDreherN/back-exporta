const db = require('../models');

async function refreshShopifyOfflineToken(shop) {
  const row = await db.Shop.findOne({
    where: { shop },
    attributes: ['shop', 'accessToken', 'refreshToken', 'tokenExpiresAt'],
    raw: true,
  });

  if (!row) {
    throw new Error(`Loja não encontrada: ${shop}`);
  }

  if (!row.refreshToken) {
    throw new Error(`Loja ${shop} sem refreshToken salvo`);
  }

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      grant_type: 'refresh_token',
      refresh_token: row.refreshToken,
    }),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {}

  if (!response.ok || !data?.access_token) {
    throw new Error(`Falha ao renovar token Shopify: ${JSON.stringify(data)}`);
  }

  const newExpiresAt = data.expires_in
    ? new Date(Date.now() + (Number(data.expires_in) * 1000))
    : null;

  await db.Shop.update({
    accessToken: data.access_token,
    refreshToken: data.refresh_token || row.refreshToken,
    tokenExpiresAt: newExpiresAt,
  }, {
    where: { shop },
  });

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || row.refreshToken,
    tokenExpiresAt: newExpiresAt,
  };
}

async function getValidShopifyAccessToken(shop) {
  const row = await db.Shop.findOne({
    where: { shop },
    attributes: ['shop', 'accessToken', 'refreshToken', 'tokenExpiresAt'],
    raw: true,
  });

  if (!row?.accessToken) {
    throw new Error(`Loja ${shop} sem accessToken salvo`);
  }

  if (!row.tokenExpiresAt) {
    return row.accessToken;
  }

  const expiresAtMs = new Date(row.tokenExpiresAt).getTime();
  const now = Date.now();

  const fiveMinutes = 5 * 60 * 1000;
  if (expiresAtMs - now > fiveMinutes) {
    return row.accessToken;
  }

  const refreshed = await refreshShopifyOfflineToken(shop);
  return refreshed.accessToken;
}

module.exports = {
  getValidShopifyAccessToken,
  refreshShopifyOfflineToken,
};