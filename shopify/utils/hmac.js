const crypto = require("crypto");

function safeEqual(a, b) {
  const aa = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

/**
 * Verifica o HMAC que a Shopify manda no querystring.
 * Retorna true/false.
 */
function verifyShopifyHmac(query, apiSecret) {
  const { hmac, signature, ...rest } = query;
  if (!hmac) return false;

  // Monta a string canônica (keys ordenadas)
  const message = Object.keys(rest)
    .sort()
    .map((k) => {
      const v = rest[k];
      return `${k}=${Array.isArray(v) ? v.join(",") : v}`;
    })
    .join("&");

  const digest = crypto
    .createHmac("sha256", apiSecret)
    .update(message)
    .digest("hex");

  return safeEqual(digest, hmac);
}

module.exports = { verifyShopifyHmac };
