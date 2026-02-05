// routes/shopifyLink.js
const express = require("express");
const router = express.Router();

const db = require("../models");
const { autenticarUsuario, vincularCliente, csrfRequired } = require("../middleware/auth");

// ✅ 1) Vincula shop -> clienteId (usuario logado no seu sistema)
router.post("/link", autenticarUsuario, vincularCliente, csrfRequired, async (req, res) => {
  try {
    const shop = String(req.body.shop || "").toLowerCase().trim();
    if (!shop || !shop.endsWith(".myshopify.com")) {
      return res.status(400).json({ ok: false, error: "shop inválida" });
    }

    const clienteId = Number(req.clienteId);
    if (!clienteId) {
      return res.status(401).json({ ok: false, error: "clienteId ausente" });
    }

    // precisa existir o model ShopClient (tabela ShopClients)
    if (!db.ShopClient) {
      return res.status(500).json({ ok: false, error: "Model ShopClient não encontrado no db" });
    }

    await db.ShopClient.upsert({ shop, clienteId });

    return res.json({ ok: true, shop, clienteId });
  } catch (e) {
    console.error("[SHOPIFY LINK] error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "server error" });
  }
});

// ✅ 2) Checa se shop já está vinculada (não exige login)
router.get("/is-linked", async (req, res) => {
  try {
    const shop = String(req.query.shop || "").toLowerCase().trim();
    if (!shop) return res.status(400).json({ ok: false, error: "missing shop" });

    if (!db.ShopClient) {
      return res.status(500).json({ ok: false, error: "Model ShopClient não encontrado no db" });
    }

    const row = await db.ShopClient.findOne({
      where: { shop },
      attributes: ["shop", "clienteId", "updatedAt"],
      raw: true,
    });

    return res.json({
      ok: true,
      isLinked: !!row,
      shop,
      clienteId: row?.clienteId || null,
      updatedAt: row?.updatedAt || null,
    });
  } catch (e) {
    console.error("[SHOPIFY IS-LINKED] error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "server error" });
  }
});

module.exports = router;
