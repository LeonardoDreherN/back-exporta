// middlewares/auth.js
const jwt = require("jsonwebtoken");
const db = require("../models");

function extrairToken(req) {
  // 1) Authorization: Bearer xxx
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1];

  // 2) (opcional) cookie httpOnly: token
  if (req.cookies?.token) return req.cookies.token;

  return null;
}

function logAuthDebug(req, stage, extra = {}) {
  if (process.env.AUTH_DEBUG === '1') {
    console.log(`[auth:${stage}]`, {
      hasAuthHeader: !!req.headers.authorization,
      hasCookie: !!req.cookies?.token,
      clienteId: req.clienteId,
      usuario: req.usuario?.id,
      ...extra,
    });
  }
}

function autenticarShopify(req, res, next) {
  const token = extrairToken(req);
  if (!token) {
    return res.status(401).json({ erro: "Token não fornecido" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // aceite as variações de claims
    const clienteId = decoded.sub || decoded.id || decoded.clienteId;
    if (!clienteId) {
      return res.status(401).json({ erro: "Token válido, mas sem clienteId" });
    }

    // padronize sempre nestes campos:
    req.clienteId = clienteId;
    req.user = {
      id: clienteId,
      email: decoded.email || decoded.emailPrincipal || null,
      roles: decoded.roles || [],
      // se quiser manter o payload completo:
      // payload: decoded,
    };

    logAuthDebug(req, "autenticarShopify_ok", { decoded });

    return next();
  } catch (e) {
    const msg = e?.name === "TokenExpiredError" ? "Token expirado" : "Token inválido";
    return res.status(401).json({ erro: msg });
  }
}

function autenticarUsuario(req, res, next) {
  const token = extrairToken(req);
  if (!token) return res.status(401).json({ erro: "Token não fornecido" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userId = decoded.userId ?? decoded.id ?? decoded.sub ?? null;
    // se o token não tiver clienteId explícito, use o próprio userId como clienteId
    const clienteId = decoded.clienteId ?? decoded.clientId ?? decoded.cid ?? userId ?? null;

    if (!userId && !clienteId) {
      return res.status(403).json({ erro: "Usuário/cliente não identificado no token" });
    }

    const usuario = {
      id: userId ? Number(userId) : null,
      clienteId: clienteId ? Number(clienteId) : null,
      email: decoded.email ?? decoded.emailPrincipal ?? null,
      roles: decoded.roles ?? [],
      // payload: decoded, // opcional
    };

    req.usuario = usuario;
    // Compatibilidade com trechos que usam req.user
    req.user = {
      id: usuario.id,
      clienteId: usuario.clienteId,
      email: usuario.email,
      roles: usuario.roles,
    };

    if (req.usuario.clienteId) req.clienteId = req.usuario.clienteId;

    return next();
  } catch (e) {
    const msg = e?.name === "TokenExpiredError" ? "Token expirado" : "Token inválido";
    return res.status(401).json({ erro: msg });
  }
}

// Resolve qual é o cliente logado e injeta req.clienteId
const vincularCliente = async (req, res, next) => {
  try {
    // 1) Se o token já trouxer clienteId, use-o
    if (req.usuario?.clienteId) {
      req.clienteId = Number(req.usuario.clienteId);
      return next();
    }

    // 2) Caso contrário, tente derivar pelo id do payload
    const possibleId = Number(req.usuario?.id);
    if (!possibleId) return res.status(403).json({ erro: "Usuário não identificado no token" });

    // Primeiro tenta por PK
    let cliente = await db.Cliente.findByPk(possibleId);

    // Opcional: se você tem a coluna user_id na tabela clientes, tente por ela
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

module.exports = { autenticarShopify, vincularCliente, autenticarUsuario };
