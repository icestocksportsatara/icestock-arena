const { query } = require('../config/db');
const logger = require('./logger');

async function recordAudit({ userId, action, entity, entityId, metadata, req }) {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        userId || null,
        action,
        entity || null,
        entityId || null,
        metadata ? JSON.stringify(metadata) : null,
        req?.ip || null,
        req?.headers?.['user-agent'] || null,
      ]
    );
  } catch (err) {
    // Audit failures must never break the main request flow.
    logger.error('Failed to write audit log', { error: err.message, action });
  }
}

module.exports = { recordAudit };
