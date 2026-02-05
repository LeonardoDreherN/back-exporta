// routes/shopifyStatus.js
const express = require("express");
const router = express.Router();

const db = require("../models/index.js");

function getShopModel() {
  // ✅ tenta db.Shop
  if (db && db.Shop) return db.Shop;

  // ✅ fallback: models registrados no sequelize
  if (db && db.sequelize && db.sequelize.models && db.sequelize.models.Shop) {
    return db.sequelize.models.Shop;
  }

  return null;
}

router.get("/has-token", async (req, res) => {
  try {
    const shop = String(req.query.shop || "").toLowerCase().trim();
    if (!shop) return res.status(400).json({ ok: false, error: "missing shop" });

    // opcional mas recomendado
    if (!shop.endsWith(".myshopify.com")) {
      return res.status(400).json({ ok: false, error: "invalid shop domain" });
    }

    const Shop = getShopModel();
    if (!Shop) {
      return res.status(500).json({
        ok: false,
        error: "Shop model not found (db.Shop / db.sequelize.models.Shop)",
      });
    }

    const row = await Shop.findOne({
      where: { shop },
      attributes: ["shop", "accessToken", "scope", "updatedAt"],
      raw: true,
    });

    const hasToken = !!row?.accessToken;

    return res.json({
      ok: true,
      hasToken,
      shop,
      updatedAt: row?.updatedAt || null,
      scope: row?.scope || null,
    });
  } catch (e) {
    console.error("[/shopify/has-token] error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "server error" });
  }
});

module.exports = router;
