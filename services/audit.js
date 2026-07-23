// services/audit.js
const db = require('../models');

async function logAdminAction({ adminUserId, action, entityType = null, entityId = null, clienteId = null, metadata = null, req = null }) {
  try {
    await db.AdminAuditLog.create({
      adminUserId: adminUserId ?? null,
      action,
      entityType,
      entityId: entityId != null ? String(entityId) : null,
      clienteId: clienteId ?? null,
      metadata: metadata ?? {},
      ipAddress: req?.ip ?? req?.headers?.['x-forwarded-for'] ?? null,
    });
  } catch (e) {
    console.error('[audit] falha ao gravar AdminAuditLog:', e.message);
  }
}

module.exports = { logAdminAction };
