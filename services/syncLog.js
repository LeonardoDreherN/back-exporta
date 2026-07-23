// services/syncLog.js
const db = require('../models');

async function logSync({ integration, clienteId = null, status = 'ok', message = null, durationMs = null }) {
  try {
    await db.SyncLog.create({
      integration,
      clienteId,
      status,
      message,
      durationMs,
    });
  } catch (e) {
    console.error('[syncLog] falha ao gravar SyncLog:', e.message);
  }
}

module.exports = { logSync };
