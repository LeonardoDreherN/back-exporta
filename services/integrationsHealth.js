// services/integrationsHealth.js
// Checagens reais de saúde por integração, usadas pelo cron de monitoramento
// (jobs/integrationsHealthCheck.js). UPS/FedEx/Database fazem uma chamada de
// verdade; Shopify/Nuvemshop não têm um endpoint de saúde global (multi-tenant,
// token por loja), então inferimos a partir da taxa de erro recente em SyncLogs.
const { Op } = require('sequelize');
const db = require('../models');
const upsOauth = require('./ups/oauth');
const fedexAuth = require('./fedex/authFedex');

async function checkDatabase() {
  const start = Date.now();
  try {
    await db.sequelize.query('SELECT 1');
    return { state: 'operational', message: null, responseTimeMs: Date.now() - start };
  } catch (e) {
    return { state: 'instability', message: e.message, responseTimeMs: Date.now() - start };
  }
}

async function checkUps() {
  const start = Date.now();
  try {
    await upsOauth.getToken();
    return { state: 'operational', message: null, responseTimeMs: Date.now() - start };
  } catch (e) {
    return { state: 'instability', message: e.message || 'Falha ao autenticar na UPS', responseTimeMs: Date.now() - start };
  }
}

async function checkFedex() {
  const start = Date.now();
  try {
    await fedexAuth.getToken();
    return { state: 'operational', message: null, responseTimeMs: Date.now() - start };
  } catch (e) {
    return { state: 'instability', message: e.message || 'Falha ao autenticar na FedEx', responseTimeMs: Date.now() - start };
  }
}

async function checkFromSyncLogs(integration) {
  const since = new Date(Date.now() - 60 * 60 * 1000); // última 1h
  const logs = await db.SyncLog.findAll({
    where: { integration, createdAt: { [Op.gte]: since } },
    attributes: ['status'],
    raw: true,
  });

  if (!logs.length) {
    return { state: 'operational', message: 'Sem atividade na última hora', responseTimeMs: null };
  }

  const errors = logs.filter((l) => l.status === 'error').length;
  if (errors > 0) {
    return { state: 'instability', message: `${errors}/${logs.length} eventos com erro na última hora`, responseTimeMs: null };
  }
  return { state: 'operational', message: null, responseTimeMs: null };
}

module.exports = {
  checkDatabase,
  checkUps,
  checkFedex,
  checkShopify: () => checkFromSyncLogs('shopify'),
  checkNuvemshop: () => checkFromSyncLogs('nuvemshop'),
};
