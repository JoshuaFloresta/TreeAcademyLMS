import { Notification } from '../models.js'
import { dbState } from '../state.js'

export async function notifyUsers(recipientIds, { title, body, link }) {
  const ids = recipientIds.filter(Boolean)
  if (!dbState.ready || !ids.length) return
  await Notification.insertMany(ids.map((recipientId) => ({ recipientId, title, body, link })))
}
