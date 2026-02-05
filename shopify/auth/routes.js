const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const { generateState, buildInstallUrl } = require("./service");
const { verifyShopifyHmac } = require("../utils/hmac");
const db = require("../../models"); // ajuste se seu index for outro

// === helpers: state assinado (nonce + clienteId) ===
function signState(nonce, clienteId) {
  const secret = process.env.SHOPIFY_API_SECRET; // pode usar outro secret se quiser
  const payload = `${nonce}.${clienteId}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${nonce}.${clienteId}.${sig}`;
}

function verifyState(state) {
  const secret = process.env.SHOPIFY_API_SECRET;
  const parts = String(state || "").split(".");
  if (parts.length !== 3) return { ok: false };

  const [nonce, clienteId, sig] = parts;
  const payload = `${nonce}.${clienteId}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  // timing safe compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false };

  const valid = crypto.timingSafeEqual(a, b);
  if (!valid) return { ok: false };

  return { ok: true, nonce, clienteId };
}

// 1) Inicia OAuth
router.get("/auth", async (req, res) => {
  const shop = String(req.query.shop || "").toLowerCase().trim();
  const clienteId = String(req.query.clienteId || "").trim();

  if (!shop || !shop.endsWith(".myshopify.com")) {
    return res.status(400).send("Missing or invalid shop");
  }

  // se você quer obrigar login Intrex antes de instalar:
  if (!clienteId) {
    // manda pro seu login e depois volta pra /shopify/auth com shop
    const returnTo = `${process.env.APP_URL}/shopify/auth?shop=${encodeURIComponent(shop)}`;
    return res.redirect(
      `${process.env.FRONT_URL}/login?returnTo=${encodeURIComponent(returnTo)}`
    );
  }

  const nonce = generateState(); // random
  const state = signState(nonce, clienteId);

  // cookie state (proteção CSRF do OAuth)
  res.cookie("shopify_state", state, {
    httpOnly: true,
    secure: false, // local=false | prod=true
    sameSite: "lax",
    maxAge: 5 * 60 * 1000,
  });

  const installUrl = buildInstallUrl({ shop, state });
  return res.redirect(installUrl);
});

// 2) Callback OAuth
router.get("/auth/callback", async (req, res) => {
  try {
    const shop = String(req.query.shop || "").toLowerCase().trim();
    const code = String(req.query.code || "").trim();
    const state = String(req.query.state || "").trim();

    if (!shop || !code || !state) {
      return res.status(400).send("Missing required parameters");
    }

    // valida state cookie
    const stateCookie = String(req.cookies.shopify_state || "").trim();
    if (!stateCookie || stateCookie !== state) {
      return res.status(403).send("Invalid state");
    }

    // valida assinatura do state (pega clienteId)
    const st = verifyState(state);
    if (!st.ok) {
      return res.status(403).send("Invalid signed state");
    }
    const clienteId = st.clienteId;

    // valida HMAC da Shopify
    const validHmac = verifyShopifyHmac(req.query, process.env.SHOPIFY_API_SECRET);
    if (!validHmac) {
      return res.status(403).send("HMAC validation failed");
    }

    // troca code por access_token
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const txt = await tokenRes.text();
      return res.status(500).send(`Token exchange failed: ${txt}`);
    }

    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;
    const scope = tokenJson.scope || process.env.SHOPIFY_SCOPES;

    // ✅ salva no banco com vínculo do cliente
    // OBS: sua tabela Shop precisa ter a coluna clienteId
    await db.Shop.upsert({
      shop,
      accessToken,
      scope,
      clienteId,
    });

    console.log("[SHOPIFY] Loja salva no banco:", { shop, clienteId });

    // redireciona pra uma página do seu sistema (pode ser uma tela "Conectado")
    return res.redirect(
      `${process.env.FRONT_URL}/bemVindo?shop=${encodeURIComponent(shop)}&connected=1`
    );
  } catch (err) {
    console.error("[SHOPIFY CALLBACK ERROR]", err);
    return res.status(500).send("Internal error on Shopify callback");
  }
});

module.exports = router;
