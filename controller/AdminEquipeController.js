const bcrypt = require('bcrypt');
const db = require('../models');
const { logAdminAction } = require('../services/audit');

const ROLES = ['admin', 'developer', 'support', 'operations'];
const SAFE_ATTRS = ['id', 'name', 'email', 'role', 'active', 'lastLoginAt', 'createdAt', 'updatedAt'];

const listAdminUsers = async (req, res) => {
  try {
    const users = await db.AdminUser.findAll({ attributes: SAFE_ATTRS, order: [['name', 'ASC']] });
    return res.json({ ok: true, data: users });
  } catch (err) {
    console.error('[AdminEquipe] listAdminUsers erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao listar equipe' });
  }
};

const createAdminUser = async (req, res) => {
  try {
    const { name, email, senha, role } = req.body || {};
    if (!name || !email || !senha || !ROLES.includes(role)) {
      return res.status(400).json({ ok: false, error: 'name, email, senha e role (válido) são obrigatórios' });
    }

    const existente = await db.AdminUser.findOne({ where: { email: email.toLowerCase().trim() } });
    if (existente) return res.status(409).json({ ok: false, error: 'E-mail já cadastrado' });

    const passwordHash = await bcrypt.hash(senha, 10);
    const adminUser = await db.AdminUser.create({
      name,
      email: email.toLowerCase().trim(),
      passwordHash,
      role,
      active: true,
    });

    await logAdminAction({ adminUserId: req.adminUser?.id, action: 'team.create', entityType: 'AdminUser', entityId: adminUser.id, req });

    const { passwordHash: _omit, ...safe } = adminUser.toJSON();
    return res.status(201).json({ ok: true, data: safe });
  } catch (err) {
    console.error('[AdminEquipe] createAdminUser erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao criar usuário admin' });
  }
};

const updateAdminUser = async (req, res) => {
  try {
    const { id } = req.params;
    const adminUser = await db.AdminUser.findByPk(id);
    if (!adminUser) return res.status(404).json({ ok: false, error: 'Usuário admin não encontrado' });

    const { name, role, active, senha } = req.body || {};
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (role !== undefined) {
      if (!ROLES.includes(role)) return res.status(400).json({ ok: false, error: 'role inválida' });
      updates.role = role;
    }
    if (active !== undefined) updates.active = !!active;
    if (senha) updates.passwordHash = await bcrypt.hash(senha, 10);

    await adminUser.update(updates);

    await logAdminAction({ adminUserId: req.adminUser?.id, action: 'team.update', entityType: 'AdminUser', entityId: adminUser.id, metadata: { name, role, active }, req });

    const { passwordHash: _omit, ...safe } = adminUser.toJSON();
    return res.json({ ok: true, data: safe });
  } catch (err) {
    console.error('[AdminEquipe] updateAdminUser erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar usuário admin' });
  }
};

const deleteAdminUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (Number(id) === req.adminUser?.id) {
      return res.status(400).json({ ok: false, error: 'Não é possível remover o próprio usuário' });
    }

    const adminUser = await db.AdminUser.findByPk(id);
    if (!adminUser) return res.status(404).json({ ok: false, error: 'Usuário admin não encontrado' });

    await adminUser.update({ active: false });

    await logAdminAction({ adminUserId: req.adminUser?.id, action: 'team.deactivate', entityType: 'AdminUser', entityId: id, req });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[AdminEquipe] deleteAdminUser erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao desativar usuário admin' });
  }
};

module.exports = { listAdminUsers, createAdminUser, updateAdminUser, deleteAdminUser };
