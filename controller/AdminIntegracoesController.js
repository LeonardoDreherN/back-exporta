const { Op } = require('sequelize');
const db = require('../models');
const { logAdminAction } = require('../services/audit');

const KNOWN_INTEGRATIONS = [
  { key: 'shopify', label: 'Shopify' },
  { key: 'nuvemshop', label: 'Nuvemshop' },
  { key: 'ups', label: 'UPS' },
  { key: 'fedex', label: 'FedEx' },
  { key: 'database', label: 'Banco de Dados' },
  { key: 'api_principal', label: 'API Principal' },
];

const getStatus = async (req, res) => {
  try {
    await Promise.all(
      KNOWN_INTEGRATIONS.map((k) =>
        db.IntegrationStatus.findOrCreate({
          where: { key: k.key },
          defaults: { label: k.label, state: 'operational' },
        })
      )
    );

    const statuses = await db.IntegrationStatus.findAll({ order: [['key', 'ASC']] });

    const dbStart = Date.now();
    let dbOk = true;
    try {
      await db.sequelize.query('SELECT 1');
    } catch {
      dbOk = false;
    }
    const dbResponseMs = Date.now() - dbStart;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const logs = await db.SyncLog.findAll({
      where: { createdAt: { [Op.gte]: since } },
      attributes: ['integration', 'status', 'durationMs', 'createdAt'],
      raw: true,
    });

    const byIntegration = {};
    for (const l of logs) {
      const b = (byIntegration[l.integration] ||= { errors: 0, total: 0, durations: [], lastSync: null });
      b.total += 1;
      if (l.status === 'error') b.errors += 1;
      if (l.durationMs != null) b.durations.push(l.durationMs);
      if (!b.lastSync || new Date(l.createdAt) > new Date(b.lastSync)) b.lastSync = l.createdAt;
    }

    const data = statuses.map((s) => {
      const agg = byIntegration[s.key] || { errors: 0, total: 0, durations: [], lastSync: null };
      const responseTimeMs = s.key === 'database'
        ? dbResponseMs
        : agg.durations.length
          ? Math.round(agg.durations.reduce((a, b) => a + b, 0) / agg.durations.length)
          : null;

      return {
        key: s.key,
        label: s.label,
        state: s.key === 'database' && !dbOk ? 'instability' : s.state,
        message: s.message,
        responseTimeMs,
        lastSync: agg.lastSync,
        errorCount24h: agg.errors,
        totalChecks24h: agg.total,
        updatedAt: s.updatedAt,
      };
    });

    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[AdminIntegracoes] getStatus erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao carregar status das integrações' });
  }
};

const setStatus = async (req, res) => {
  try {
    const { key } = req.params;
    const { state, message } = req.body || {};

    if (!['operational', 'maintenance', 'instability'].includes(state)) {
      return res.status(400).json({ ok: false, error: 'state inválido' });
    }

    const row = await db.IntegrationStatus.findOne({ where: { key } });
    if (!row) return res.status(404).json({ ok: false, error: 'Integração não encontrada' });

    const previousState = row.state;
    await row.update({ state, message: message ?? row.message, updatedBy: req.adminUser?.id ?? null });

    await db.StatusIncident.create({
      integrationKey: key,
      previousState,
      newState: state,
      message: message || null,
      createdBy: req.adminUser?.id ?? null,
    });

    await logAdminAction({
      adminUserId: req.adminUser?.id,
      action: 'integration.status_change',
      entityType: 'IntegrationStatus',
      entityId: key,
      metadata: { previousState, newState: state, message: message || null },
      req,
    });

    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error('[AdminIntegracoes] setStatus erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar status da integração' });
  }
};

const getLogs = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const { integration, status, clienteId, date_from, date_to } = req.query;

    const where = {};
    if (integration) where.integration = integration;
    if (status) where.status = status;
    if (clienteId) where.clienteId = clienteId;
    if (date_from || date_to) {
      where.createdAt = {};
      if (date_from) where.createdAt[Op.gte] = new Date(`${date_from}T00:00:00.000Z`);
      if (date_to) where.createdAt[Op.lte] = new Date(`${date_to}T23:59:59.999Z`);
    }

    const { rows, count } = await db.SyncLog.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    });

    return res.json({
      ok: true,
      data: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    });
  } catch (err) {
    console.error('[AdminIntegracoes] getLogs erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao carregar logs de sincronização' });
  }
};

module.exports = { getStatus, setStatus, getLogs };
