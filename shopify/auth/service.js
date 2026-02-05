const crypto = require("crypto");

function generateState() {
  return crypto.randomBytes(16).toString("hex");
}

function buildInstallUrl({ shop, state }) {
  const scopes = process.env.SHOPIFY_SCOPES || "";

  // remove / final se existir
  const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");

  // ✅ redirect EXATO que o Shopify exige
  // (como você montou: app.use("/shopify", shopifyAuthRoutes))
  const redirectUri = `${appUrl}/shopify/auth/callback`;

  return (
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(process.env.SHOPIFY_API_KEY)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`
  );
}

module.exports = { generateState, buildInstallUrl };
