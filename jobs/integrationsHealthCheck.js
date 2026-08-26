// jobs/integrationsHealthCheck.js
// Roda periodicamente (agendado em server.js) e mantém IntegrationStatus
// sincronizado com a saúde real de cada integração. Se o estado mudar,
// registra um StatusIncident automático (createdBy: null = sistema).
//
// Regra: 'maintenance' é um estado só-admin (manutenção programada, decisão
// humana) — o checker automático nunca sai desse estado sozinho, só alterna
// entre 'operational'/'instability' com base em checagens reais.
const db = require('../models');
const health = require('../services/integrationsHealth');
const { logSync } = require('../services/syncLog');
const { enviarAlertaSlack } = require('../services/notifications/slack');

const CHECKS = {
  database: health.checkDatabase,
  ups: health.checkUps,
  fedex: health.checkFedex,
  shopify: health.checkShopify,
  nuvemshop: health.checkNuvemshop,
};

// Só essas fazem uma chamada de rede de verdade — vale registrar como
// SyncLog para alimentar "última sincronização"/tempo de resposta. Shopify e
// Nuvemshop já SÃO derivados de SyncLogs, então logar de novo criaria um
// ciclo (o check influenciando o próximo check).
const LOGGABLE = new Set(['database', 'ups', 'fedex']);

async function run() {
  for (const [key, checkFn] of Object.entries(CHECKS)) {
    try {
      const row = await db.IntegrationStatus.findOne({ where: { key } });
      if (!row) continue; // inicializado no primeiro GET /api/admin/integracoes/status
      if (row.state === 'maintenance') continue; // respeita decisão manual

      const result = await checkFn();

      if (row.state !== result.state) {
        const previousState = row.state;
        await db.StatusIncident.create({
          integrationKey: key,
          previousState,
          newState: result.state,
          message: result.message ? `Detectado automaticamente: ${result.message}` : 'Detectado automaticamente',
          createdBy: null,
        });
        await row.update({ state: result.state, message: result.message, updatedBy: null });

        enviarAlertaSlack({
          title:
            result.state === 'operational'
              ? `${row.label} voltou ao normal`
              : `${row.label} está com instabilidade`,
          message: result.message || `Estado mudou de ${previousState} para ${result.state}`,
          severity: result.state === 'operational' ? 'success' : 'critical',
        }).catch(() => {});
      }

      if (LOGGABLE.has(key)) {
        await logSync({
          integration: key,
          status: result.state === 'operational' ? 'ok' : 'error',
          message: result.message || 'health-check automático',
          durationMs: result.responseTimeMs,
        });
      }
    } catch (e) {
      console.error(`[integrationsHealthCheck] erro ao checar ${key}:`, e.message);
    }
  }
}

module.exports = { run };
