const db = require('../models');
const { logAdminAction } = require('../services/audit');

const listEntries = async (req, res) => {
  try {
    const entries = await db.ChangelogEntry.findAll({ order: [['releaseDate', 'DESC']] });
    return res.json({ ok: true, data: entries });
  } catch (err) {
    console.error('[AdminChangelog] listEntries erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao listar changelog' });
  }
};

const createEntry = async (req, res) => {
  try {
    const { version, releaseDate, changes, published } = req.body || {};
    if (!version || !releaseDate) {
      return res.status(400).json({ ok: false, error: 'version e releaseDate são obrigatórios' });
    }

    const entry = await db.ChangelogEntry.create({
      version,
      releaseDate,
      changes: Array.isArray(changes) ? changes : [],
      published: !!published,
      createdBy: req.adminUser?.id ?? null,
    });

    await logAdminAction({ adminUserId: req.adminUser?.id, action: 'changelog.create', entityType: 'ChangelogEntry', entityId: entry.id, req });

    return res.status(201).json({ ok: true, data: entry });
  } catch (err) {
    console.error('[AdminChangelog] createEntry erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao criar entrada de changelog' });
  }
};

const updateEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await db.ChangelogEntry.findByPk(id);
    if (!entry) return res.status(404).json({ ok: false, error: 'Entrada não encontrada' });

    const allowed = ['version', 'releaseDate', 'changes', 'published'];
    const updates = {};
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) updates[key] = req.body[key];
    }
    await entry.update(updates);

    await logAdminAction({ adminUserId: req.adminUser?.id, action: 'changelog.update', entityType: 'ChangelogEntry', entityId: entry.id, metadata: updates, req });

    return res.json({ ok: true, data: entry });
  } catch (err) {
    console.error('[AdminChangelog] updateEntry erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar entrada de changelog' });
  }
};

const deleteEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await db.ChangelogEntry.findByPk(id);
    if (!entry) return res.status(404).json({ ok: false, error: 'Entrada não encontrada' });

    await entry.destroy();
    await logAdminAction({ adminUserId: req.adminUser?.id, action: 'changelog.delete', entityType: 'ChangelogEntry', entityId: id, req });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[AdminChangelog] deleteEntry erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao excluir entrada de changelog' });
  }
};

const listPublicEntries = async (req, res) => {
  try {
    const entries = await db.ChangelogEntry.findAll({
      where: { published: true },
      order: [['releaseDate', 'DESC']],
      attributes: ['id', 'version', 'releaseDate', 'changes'],
    });
    return res.json({ ok: true, data: entries });
  } catch (err) {
    console.error('[AdminChangelog] listPublicEntries erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao listar changelog público' });
  }
};

module.exports = { listEntries, createEntry, updateEntry, deleteEntry, listPublicEntries };
