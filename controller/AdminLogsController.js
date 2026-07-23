const { Op } = require('sequelize');
const db = require('../models');

const listLogs = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const { adminUserId, clienteId, action, date_from, date_to } = req.query;

    const where = {};
    if (adminUserId) where.adminUserId = adminUserId;
    if (clienteId) where.clienteId = clienteId;
    if (action) where.action = { [Op.iLike]: `%${action}%` };
    if (date_from || date_to) {
      where.createdAt = {};
      if (date_from) where.createdAt[Op.gte] = new Date(`${date_from}T00:00:00.000Z`);
      if (date_to) where.createdAt[Op.lte] = new Date(`${date_to}T23:59:59.999Z`);
    }

    const { rows, count } = await db.AdminAuditLog.findAndCountAll({
      where,
      include: [
        { model: db.AdminUser, as: 'adminUser', attributes: ['id', 'name', 'email'], required: false },
        { model: db.Cliente, as: 'cliente', attributes: ['id', 'razaoSocial'], required: false },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    });

    return res.json({ ok: true, data: rows, pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } });
  } catch (err) {
    console.error('[AdminLogs] listLogs erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao listar logs' });
  }
};

module.exports = { listLogs };
