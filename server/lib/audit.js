import { AuditLog } from '../models.js'
import { dbState } from '../state.js'

export async function saveAudit(action, entityType, entityId, metadata = {}, actorId) {
  if (dbState.ready) await AuditLog.create({ action, entityType, entityId, metadata, actorId })
}
