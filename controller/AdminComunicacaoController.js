const { Op } = require('sequelize');
const db = require('../models');
const { logAdminAction } = require('../services/audit');

const CATEGORIES = ['atualizacao', 'manutencao', 'incidente', 'novidade'];
const AUDIENCES = ['todos', 'cliente_especifico', 'shopify', 'nuvemshop'];

const listAnnouncements = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const { category, audience, active } = req.query;

    const where = {};
    if (category) where.category = category;
    if (audience) where.audience = audience;
    if (active !== undefined) where.active = active === 'true';

    const { rows, count } = await db.Announcement.findAndCountAll({
      where,
      include: [{ model: db.Cliente, as: 'cliente', attributes: ['id', 'razaoSocial'], required: false }],
      order: [['createdAt', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    });

    return res.json({ ok: true, data: rows, pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } });
  } catch (err) {
    console.error('[AdminComunicacao] listAnnouncements erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao listar comunicados' });
  }
};

const createAnnouncement = async (req, res) => {
  try {
    const { title, body, category, audience, clienteId, showBanner, showOnStatusPage, active, publishedAt } = req.body || {};

    if (!title || !body || !CATEGORIES.includes(category) || !AUDIENCES.includes(audience)) {
      return res.status(400).json({ ok: false, error: 'Campos obrigatórios inválidos ou ausentes' });
    }
    if (audience === 'cliente_especifico' && !clienteId) {
      return res.status(400).json({ ok: false, error: 'Informe clienteId para audiência específica' });
    }

    const announcement = await db.Announcement.create({
      title,
      body,
      category,
      audience,
      clienteId: audience === 'cliente_especifico' ? clienteId : null,
      showBanner: !!showBanner,
      showOnStatusPage: !!showOnStatusPage,
      active: active !== undefined ? !!active : true,
      publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
      createdBy: req.adminUser?.id ?? null,
    });

    await logAdminAction({
      adminUserId: req.adminUser?.id,
      action: 'announcement.create',
      entityType: 'Announcement',
      entityId: announcement.id,
      clienteId: announcement.clienteId,
      req,
    });

    return res.status(201).json({ ok: true, data: announcement });
  } catch (err) {
    console.error('[AdminComunicacao] createAnnouncement erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao criar comunicado' });
  }
};

const updateAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const announcement = await db.Announcement.findByPk(id);
    if (!announcement) return res.status(404).json({ ok: false, error: 'Comunicado não encontrado' });

    const allowed = ['title', 'body', 'category', 'audience', 'clienteId', 'showBanner', 'showOnStatusPage', 'active', 'publishedAt'];
    const updates = {};
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) updates[key] = req.body[key];
    }

    await announcement.update(updates);

    await logAdminAction({
      adminUserId: req.adminUser?.id,
      action: 'announcement.update',
      entityType: 'Announcement',
      entityId: announcement.id,
      clienteId: announcement.clienteId,
      metadata: updates,
      req,
    });

    return res.json({ ok: true, data: announcement });
  } catch (err) {
    console.error('[AdminComunicacao] updateAnnouncement erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar comunicado' });
  }
};

const deleteAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const announcement = await db.Announcement.findByPk(id);
    if (!announcement) return res.status(404).json({ ok: false, error: 'Comunicado não encontrado' });

    await announcement.destroy();

    await logAdminAction({
      adminUserId: req.adminUser?.id,
      action: 'announcement.delete',
      entityType: 'Announcement',
      entityId: id,
      req,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[AdminComunicacao] deleteAnnouncement erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao excluir comunicado' });
  }
};

// Usado pelo app do cliente para exibir o banner interno
const getBannerForCliente = async (req, res) => {
  try {
    const clienteId = req.clienteId;
    const platformFilters = [];

    const infoShopify = await db.InfoShopify.findOne({ where: { id_cliente: clienteId } });
    if (infoShopify) platformFilters.push('shopify');
    const infoNuvemshop = await db.InfoNuvemshop.findOne({ where: { id_cliente: clienteId } });
    if (infoNuvemshop) platformFilters.push('nuvemshop');

    const audienceOr = [{ audience: 'todos' }, { audience: 'cliente_especifico', clienteId }];
    if (platformFilters.length) audienceOr.push({ audience: { [Op.in]: platformFilters } });

    const announcements = await db.Announcement.findAll({
      where: { active: true, showBanner: true, [Op.or]: audienceOr },
      order: [['publishedAt', 'DESC']],
      limit: 5,
      attributes: ['id', 'title', 'body', 'category', 'publishedAt'],
    });

    return res.json({ ok: true, data: announcements });
  } catch (err) {
    console.error('[AdminComunicacao] getBannerForCliente erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao carregar comunicados' });
  }
};

module.exports = { listAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement, getBannerForCliente };
