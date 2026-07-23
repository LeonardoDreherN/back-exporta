// middleware/adminAuth.js
const jwt = require('jsonwebtoken');
const db = require('../models');

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;
const ADMIN_JWT_REFRESH_SECRET = process.env.ADMIN_JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET;

function extrairTokenAdmin(req) {
  if (req.cookies?.admin_access_token) return req.cookies.admin_access_token;

  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1];

  return null;
}

async function autenticarAdmin(req, res, next) {
  const token = extrairTokenAdmin(req);
  if (!token) {
    return res.status(401).json({ erro: 'Token de admin não fornecido' });
  }

  try {
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET);
    if (decoded.scope !== 'admin' || !decoded.adminId) {
      return res.status(403).json({ erro: 'Token não é de um usuário admin' });
    }

    const adminUser = await db.AdminUser.findByPk(decoded.adminId, {
      attributes: ['id', 'name', 'email', 'role', 'active'],
    });

    if (!adminUser || !adminUser.active) {
      return res.status(403).json({ erro: 'Usuário admin inativo ou não encontrado' });
    }

    req.adminUser = {
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      role: adminUser.role,
    };

    return next();
  } catch (e) {
    const msg = e?.name === 'TokenExpiredError' ? 'Token expirado' : 'Token inválido';
    return res.status(401).json({ erro: msg });
  }
}

function requireAdminRole(...roles) {
  return (req, res, next) => {
    if (!req.adminUser) {
      return res.status(401).json({ erro: 'Não autenticado' });
    }
    if (roles.length && !roles.includes(req.adminUser.role)) {
      return res.status(403).json({ erro: 'Permissão insuficiente para esta ação' });
    }
    return next();
  };
}

module.exports = {
  autenticarAdmin,
  requireAdminRole,
  ADMIN_JWT_SECRET,
  ADMIN_JWT_REFRESH_SECRET,
};
