// middlewares/auth.js
const jwt = require("jsonwebtoken");
const db = require("../models");

function extrairToken(req) {
  if (req.cookies?.token) return req.cookies.token;
  if (req.cookies?.access_token) return req.cookies.access_token;

  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1];

  return null;
}

function getHostFromUrlMaybe(value) {
  try {
    return new URL(String(value)).host.toLowerCase();
  } catch {
    return null;
  }
}

function isProbablyShopifySessionToken(token) {
  try {
    const decoded = jwt.decode(token);
    return !!(
      decoded &&
      typeof decoded === "object" &&
      (decoded.dest || decoded.aud || decoded.iss)
    );
  } catch {
    return false;
  }
}

async function tryAuthenticateShopifySession(req, token) {
  if (!isProbablyShopifySessionToken(token)) return false;

  const decoded = jwt.verify(token, process.env.SHOPIFY_API_SECRET, {
    algorithms: ["HS256"],
    audience: process.env.SHOPIFY_API_KEY,
  });

  const destHost = getHostFromUrlMaybe(decoded.dest);
  const issHost = getHostFromUrlMaybe(decoded.iss);

  if (!destHost || !destHost.endsWith(".myshopify.com")) {
    throw new Error("Shopify session token sem dest válido");
  }

  if (issHost && !issHost.includes("shopify")) {
    throw new Error("Shopify session token com iss inválido");
  }

  const info = await db.InfoShopify.findOne({
    where: { shopDomain: destHost },
    attributes: ["id_cliente", "shopDomain"],
    raw: true,
  });

  req.shopifySession = decoded;
  req.shopDomain = destHost;

  if (info?.id_cliente) {
    req.clienteId = Number(info.id_cliente);
  }

  req.usuario = {
    id: null,
    clienteId: req.clienteId ?? null,
    email: null,
    roles: ["shopify_embedded"],
    razaoSocial: null,
    shopDomain: destHost,
    shopifySub: decoded.sub || null,
  };

  req.user = {
    id: null,
    clienteId: req.clienteId ?? null,
    email: null,
    roles: ["shopify_embedded"],
    shopDomain: destHost,
  };

  return true;
}

async function autenticarShopify(req, res, next) {
  const token = extrairToken(req);
  if (!token) {
    return res.status(401).json({ erro: "Token não fornecido" });
  }

  try {
    const okShopify = await tryAuthenticateShopifySession(req, token);
    if (okShopify) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const clienteId = decoded.sub || decoded.id || decoded.clienteId;
    if (!clienteId) {
      return res.status(401).json({ erro: "Token válido, mas sem clienteId" });
    }

    req.clienteId = Number(clienteId);
    req.user = {
      id: Number(clienteId),
      email: decoded.email || decoded.emailPrincipal || null,
      roles: decoded.roles || [],
    };

    return next();
  } catch (e) {
    const msg = e?.name === "TokenExpiredError" ? "Token expirado" : "Token inválido";
    return res.status(401).json({ erro: msg });
  }
}

async function autenticarUsuario(req, res, next) {
  const token = extrairToken(req);

  if (!token) {
    return res.status(401).json({ erro: "Token não fornecido" });
  }

  try {
    const okShopify = await tryAuthenticateShopifySession(req, token);
    if (okShopify) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userId = decoded.userId ?? decoded.id ?? decoded.sub ?? null;
    const clienteId = decoded.clienteId ?? decoded.clientId ?? decoded.cid ?? userId ?? null;

    if (!userId && !clienteId) {
      return res.status(403).json({ erro: "Usuário/cliente não identificado no token" });
    }

    const usuario = {
      id: userId ? Number(userId) : null,
      clienteId: clienteId ? Number(clienteId) : null,
      email: decoded.email ?? decoded.emailPrincipal ?? null,
      roles: decoded.roles ?? [],
      razaoSocial: decoded.razaoSocial ?? null,
    };

    req.usuario = usuario;
    req.user = {
      id: usuario.id,
      clienteId: usuario.clienteId,
      email: usuario.email,
      roles: usuario.roles,
    };

    if (req.usuario.clienteId) req.clienteId = req.usuario.clienteId;

    return next();
  } catch (e) {
    console.error("[auth] erro ao verificar token", e);
    const msg = e?.name === "TokenExpiredError" ? "Token expirado" : "Token inválido";
    return res.status(401).json({ erro: msg });
  }
}

const vincularCliente = async (req, res, next) => {
  try {
    if (req.clienteId) {
      req.clienteId = Number(req.clienteId);
      return next();
    }

    const possibleId = Number(req.usuario?.id);
    if (!possibleId) {
      return res.status(403).json({ erro: "Usuário não identificado no token" });
    }

    let cliente = await db.Cliente.findByPk(possibleId);

    if (!cliente && db.Cliente.rawAttributes.user_id) {
      cliente = await db.Cliente.findOne({ where: { user_id: possibleId } });
    }

    if (!cliente) return res.status(403).json({ erro: "Cliente não vinculado" });

    req.clienteId = cliente.id;
    next();
  } catch (e) {
    return res.status(500).json({ erro: "Falha ao vincular cliente" });
  }
};

function csrfRequired(req, res, next) {
  const auth = req.headers.authorization || "";
  const hasBearer = /^Bearer\s+/i.test(auth);
  if (hasBearer) {
    return next();
  }

  if (!/^(POST|PUT|PATCH|DELETE)$/i.test(req.method)) return next();

  const header = req.get("x-csrf-token");
  const cookie = req.cookies?.csrf_token;

  if (header && cookie && header === cookie) return next();

  return res.status(403).json({ erro: "CSRF inválido" });
}

module.exports = {
  autenticarShopify,
  vincularCliente,
  autenticarUsuario,
  csrfRequired,
};