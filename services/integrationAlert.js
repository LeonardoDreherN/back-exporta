// services/integrationAlert.js
const db = require('../models');

// Sinaliza instabilidade numa integração (ex.: 429 persistente após esgotar as
// retentativas) usando a mesma tabela que já alimenta a status page pública
// (IntegrationStatus/StatusIncident, já usada pelo health-check periódico em
// jobs/integrationsHealthCheck.js). Não sobrescreve 'maintenance' (decisão manual)
// nem duplica incidente se já estiver marcado como instável — o health-check
// periódico já existente volta o estado pra 'operational' sozinho quando normalizar.
async function sinalizarInstabilidade(key, message) {
    try {
        const row = await db.IntegrationStatus.findOne({ where: { key } });
        if (!row || row.state === 'maintenance' || row.state === 'instability') return;

        await db.StatusIncident.create({
            integrationKey: key,
            previousState: row.state,
            newState: 'instability',
            message: `Detectado automaticamente: ${message}`,
            createdBy: null,
        });
        await row.update({ state: 'instability', message });
    } catch (e) {
        console.error('[integrationAlert] falha ao sinalizar instabilidade:', e.message);
    }
}

module.exports = { sinalizarInstabilidade };
