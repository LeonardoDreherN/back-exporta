// middlewares/auth.js
const jwt = require("jsonwebtoken");
const db = require("../models");

// Autentica e injeta o payload do token
const autenticar = (req, res, next) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ erro: "Token não fornecido" });

  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) {
    const msg = e?.name === "TokenExpiredError" ? "Token expirado" : "Token inválido";
    return res.status(401).json({ erro: msg });
  }
};

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
