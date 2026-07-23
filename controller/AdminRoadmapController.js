const db = require('../models');
const { logAdminAction } = require('../services/audit');

const COLUMNS = ['planejado', 'em_desenvolvimento', 'em_testes', 'publicado'];

const listCards = async (req, res) => {
  try {
    const cards = await db.RoadmapCard.findAll({ order: [['column', 'ASC'], ['position', 'ASC']] });
    return res.json({ ok: true, data: cards });
  } catch (err) {
    console.error('[AdminRoadmap] listCards erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao listar roadmap' });
  }
};

const createCard = async (req, res) => {
  try {
    const { title, description, column } = req.body || {};
    if (!title || !COLUMNS.includes(column)) {
      return res.status(400).json({ ok: false, error: 'title e column (válido) são obrigatórios' });
    }

    const maxPosition = await db.RoadmapCard.max('position', { where: { column } });
    const card = await db.RoadmapCard.create({
      title,
      description: description || null,
      column,
      position: (maxPosition || 0) + 1,
      createdBy: req.adminUser?.id ?? null,
    });

    await logAdminAction({ adminUserId: req.adminUser?.id, action: 'roadmap.create', entityType: 'RoadmapCard', entityId: card.id, req });

    return res.status(201).json({ ok: true, data: card });
  } catch (err) {
    console.error('[AdminRoadmap] createCard erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao criar card' });
  }
};

const updateCard = async (req, res) => {
  try {
    const { id } = req.params;
    const card = await db.RoadmapCard.findByPk(id);
    if (!card) return res.status(404).json({ ok: false, error: 'Card não encontrado' });

    const allowed = ['title', 'description'];
    const updates = {};
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) updates[key] = req.body[key];
    }
    await card.update(updates);

    await logAdminAction({ adminUserId: req.adminUser?.id, action: 'roadmap.update', entityType: 'RoadmapCard', entityId: card.id, metadata: updates, req });

    return res.json({ ok: true, data: card });
  } catch (err) {
    console.error('[AdminRoadmap] updateCard erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar card' });
  }
};

const moveCard = async (req, res) => {
  try {
    const { id } = req.params;
    const { column, position } = req.body || {};
    if (!COLUMNS.includes(column)) return res.status(400).json({ ok: false, error: 'column inválida' });

    const card = await db.RoadmapCard.findByPk(id);
    if (!card) return res.status(404).json({ ok: false, error: 'Card não encontrado' });

    const columnAnterior = card.column;
    const maxPosition = await db.RoadmapCard.max('position', { where: { column } });
    const finalPosition = Number.isFinite(position) ? position : (maxPosition || 0) + 1;

    await card.update({ column, position: finalPosition });

    await logAdminAction({
      adminUserId: req.adminUser?.id,
      action: 'roadmap.move',
      entityType: 'RoadmapCard',
      entityId: card.id,
      metadata: { columnAnterior, columnNovo: column },
      req,
    });

    return res.json({ ok: true, data: card });
  } catch (err) {
    console.error('[AdminRoadmap] moveCard erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao mover card' });
  }
};

const deleteCard = async (req, res) => {
  try {
    const { id } = req.params;
    const card = await db.RoadmapCard.findByPk(id);
    if (!card) return res.status(404).json({ ok: false, error: 'Card não encontrado' });

    await card.destroy();
    await logAdminAction({ adminUserId: req.adminUser?.id, action: 'roadmap.delete', entityType: 'RoadmapCard', entityId: id, req });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[AdminRoadmap] deleteCard erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao excluir card' });
  }
};

module.exports = { listCards, createCard, updateCard, moveCard, deleteCard };
