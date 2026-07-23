const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../models');
const { ADMIN_JWT_SECRET, ADMIN_JWT_REFRESH_SECRET } = require('../middleware/adminAuth');
const { logAdminAction } = require('../services/audit');

const ADMIN_ACCESS_TTL = 60 * 60 * 8; // 8h
const ADMIN_REFRESH_TTL = 7 * 24 * 60 * 60; // 7 dias
const isProd = process.env.NODE_ENV === 'production';

const cookieBase = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax',
  path: '/',
};

function signAdminAccess(adminUser) {
  return jwt.sign(
    { scope: 'admin', adminId: adminUser.id, role: adminUser.role, email: adminUser.email },
    ADMIN_JWT_SECRET,
    { expiresIn: ADMIN_ACCESS_TTL }
  );
}

function signAdminRefresh(adminUser) {
  return jwt.sign(
    { scope: 'admin', adminId: adminUser.id, jti: crypto.randomUUID() },
    ADMIN_JWT_REFRESH_SECRET,
    { expiresIn: ADMIN_REFRESH_TTL }
  );
}

const loginAdmin = async (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) {
    return res.status(400).json({ erro: 'Informe email e senha' });
  }

  try {
    const adminUser = await db.AdminUser.findOne({ where: { email: email.toLowerCase().trim() } });
    if (!adminUser || !adminUser.active) {
      return res.status(401).json({ erro: 'Credenciais inválidas' });
    }

    const ok = await bcrypt.compare(senha, adminUser.passwordHash);
    if (!ok) {
      return res.status(401).json({ erro: 'Credenciais inválidas' });
    }

    await adminUser.update({ lastLoginAt: new Date() });

    const access = signAdminAccess(adminUser);
    const refresh = signAdminRefresh(adminUser);

    res.cookie('admin_access_token', access, { ...cookieBase, maxAge: ADMIN_ACCESS_TTL * 1000 });
    res.cookie('admin_refresh_token', refresh, { ...cookieBase, maxAge: ADMIN_REFRESH_TTL * 1000 });

    await logAdminAction({
      adminUserId: adminUser.id,
      action: 'admin.login',
      entityType: 'AdminUser',
      entityId: adminUser.id,
      req,
    });

    return res.json({
      ok: true,
      accessToken: access,
      admin: { id: adminUser.id, name: adminUser.name, email: adminUser.email, role: adminUser.role },
    });
  } catch (err) {
    console.error('[AdminAuth] erro no login:', err);
    return res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

const meAdmin = async (req, res) => {
  if (!req.adminUser) return res.status(401).json({ erro: 'Não autenticado' });
  return res.json({ admin: req.adminUser });
};

const refreshAdmin = (req, res) => {
  const rt = req.cookies?.admin_refresh_token;
  if (!rt) return res.status(401).json({ erro: 'Sem refresh' });

  try {
    const data = jwt.verify(rt, ADMIN_JWT_REFRESH_SECRET);
    if (data.scope !== 'admin') throw new Error('scope inválido');

    db.AdminUser.findByPk(data.adminId).then((adminUser) => {
      if (!adminUser || !adminUser.active) {
        return res.status(401).json({ erro: 'Usuário admin inválido' });
      }
      const access = signAdminAccess(adminUser);
      res.cookie('admin_access_token', access, { ...cookieBase, maxAge: ADMIN_ACCESS_TTL * 1000 });
      return res.json({ ok: true, accessToken: access });
    });
  } catch {
    return res.status(401).json({ erro: 'Refresh inválido' });
  }
};

const logoutAdmin = (req, res) => {
  const clearBase = { path: '/', secure: isProd, sameSite: isProd ? 'none' : 'lax' };
  res.clearCookie('admin_access_token', clearBase);
  res.clearCookie('admin_refresh_token', clearBase);
  res.json({ ok: true });
};

module.exports = { loginAdmin, meAdmin, refreshAdmin, logoutAdmin };
