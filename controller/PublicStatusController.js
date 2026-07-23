const db = require('../models');

const getPublicStatus = async (req, res) => {
  try {
    const statuses = await db.IntegrationStatus.findAll({
      attributes: ['key', 'label', 'state', 'message', 'updatedAt'],
      order: [['key', 'ASC']],
    });

    const incidents = await db.StatusIncident.findAll({
      order: [['createdAt', 'DESC']],
      limit: 20,
      attributes: ['id', 'integrationKey', 'previousState', 'newState', 'message', 'createdAt'],
    });

    const announcements = await db.Announcement.findAll({
      where: { active: true, showOnStatusPage: true },
      order: [['publishedAt', 'DESC']],
      limit: 20,
      attributes: ['id', 'title', 'body', 'category', 'publishedAt'],
    });

    const overall = statuses.some((s) => s.state === 'instability')
      ? 'instability'
      : statuses.some((s) => s.state === 'maintenance')
        ? 'maintenance'
        : 'operational';

    return res.json({
      ok: true,
      data: { overall, integrations: statuses, incidents, announcements },
    });
  } catch (err) {
    console.error('[PublicStatus] erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao carregar status' });
  }
};

module.exports = { getPublicStatus };
