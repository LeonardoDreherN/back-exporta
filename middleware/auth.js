// middlewares/auth.js
const jwt = require("jsonwebtoken");
const db = require("../models");

function extrairToken(req) {
  if (req.cookies?.token) return req.cookies.token;
  if (req.cookies?.access_token) return req.cookies.access_token;

  // 1) Authorization: Bearer xxx
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1];

  return null;
}

function logAuthDebug(req, stage, extra = {}) {
  if (process.env.AUTH_DEBUG === '1') {
    console.log(`[auth:${stage}]`, {
      hasAuthHeader: !!req.headers.authorization,
      hasAccessCookie: !!req.cookies?.access_token,
      hasLegacyCookie: !!req.cookies?.token,
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
  console.log('==================== [auth] INICIO ====================');
  console.log('[auth] headers.authorization =', req.headers.authorization);
  console.log('[auth] cookies =', req.cookies);

  const token = extrairToken(req);
  console.log('[auth] token extraído =', token ? 'OK' : 'NENHUM');

  if (!token) {
    console.log('[auth] SAINDO: Token não fornecido');
    return res.status(401).json({ erro: "Token não fornecido" });
  }

  try {
    console.log('[auth] JWT_SECRET length =', (process.env.JWT_SECRET || '').length);

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('[auth] decoded =', decoded);

    const userId = decoded.userId ?? decoded.id ?? decoded.sub ?? null;
    const clienteId = decoded.clienteId ?? decoded.clientId ?? decoded.cid ?? userId ?? null;

    if (!userId && !clienteId) {
      console.log('[auth] SAINDO: usuário/cliente não identificado');
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

    console.log('[auth] usuario montado =', usuario);
    console.log('==================== [auth] FIM OK ====================');
    return next();
  } catch (e) {
    console.error('[auth] erro ao verificar token', e);
    const msg = e?.name === "TokenExpiredError" ? "Token expirado" : "Token inválido";
    console.log('[auth] SAINDO:', msg);
    return res.status(401).json({ erro: msg });
  }
}


// Resolve qual é o cliente logado e injeta req.clienteId
const vincularCliente = async (req, res, next) => {
  try {
    // 1) Se o token já trouxer clienteId, use-o
    if (req.clienteId) {
      req.clienteId = Number(req.clienteId);
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

function csrfRequired(req, res, next) {
  // Só exige em métodos que mudam estado
  if (!/^(POST|PUT|PATCH|DELETE)$/i.test(req.method)) return next();
  const header = req.get('x-csrf-token');
  const cookie = req.cookies?.csrf_token;
  if (header && cookie && header === cookie) return next();

  console.log('[CSRF DEBUG]', {
    method: req.method,
    url: req.originalUrl,
    header,
    cookie,
  });

  return res.status(403).json({ erro: 'CSRF inválido' });
};

module.exports = { autenticarShopify, vincularCliente, autenticarUsuario, csrfRequired };
