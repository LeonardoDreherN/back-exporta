const express = require("express");
const crypto = require("crypto");

const router = express.Router();

/**
 * 🔐 Validação HMAC da Shopify (Webhook)
 */
function verifyShopifyWebhook(req) {
  const hmacHeader = req.headers["x-shopify-hmac-sha256"];
  if (!hmacHeader) return false;

  const hash = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(req.rawBody, "utf8")
    .digest("base64");

  return crypto.timingSafeEqual(
    Buffer.from(hash, "utf8"),
    Buffer.from(hmacHeader, "utf8")
  );
}

/**
 * 📦 Webhook: Order Create
 */
router.post("/orders/create", async (req, res) => {
  try {
    // 🔐 valida se veio da Shopify
    const valid = verifyShopifyWebhook(req);
    if (!valid) {
      console.error("❌ Webhook Shopify inválido (HMAC)");
      return res.status(401).send("invalid webhook");
    }

    const order = req.body;

    console.log("✅ Pedido recebido da Shopify");
    console.log("Order ID:", order.id);
    console.log("Shop:", req.headers["x-shopify-shop-domain"]);

    /**
     * 🚀 PRÓXIMO PASSO (depois):
     * - salvar pedido no banco
     * - transformar no formato Intrex
     * - gerar cotação / envio
     */

    // Shopify exige resposta rápida
    return res.status(200).send("ok");
  } catch (err) {
    console.error("Erro webhook orders/create:", err);
    return res.status(500).send("error");
  }
});

module.exports = router;
