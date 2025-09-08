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

function autenticar(req, res, next) {
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

module.exports = { autenticar, vincularCliente };
