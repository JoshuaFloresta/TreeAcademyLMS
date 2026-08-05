import express from 'express'
import mongoose from 'mongoose'
import { Presence } from '../models.js'
import { dbState, memory } from '../state.js'
import { asyncRoute } from '../lib/http.js'

export const router = express.Router()

router.get('/api/presence', asyncRoute(async (_req, res) => {
  if (!dbState.ready) return res.json([...memory.presence.values()])
  const onlineSince = new Date(Date.now() - 90_000)
  const records = await Presence.find({ lastHeartbeatAt: { $gte: onlineSince } }).populate('userId', 'name role avatarUrl').lean()
  res.json(records.map(({ userId }) => userId).filter(Boolean))
}))

export function registerPresenceSocket(io) {
  io.on('connection', (socket) => {
    socket.on('presence:heartbeat', async (profile) => {
      if (!profile?.id || !['learner', 'instructor', 'admin'].includes(profile.role)) return
      const record = { id: profile.id, name: profile.name, role: profile.role, avatarUrl: profile.avatarUrl, socketId: socket.id, lastHeartbeatAt: new Date() }
      memory.presence.set(profile.id, record)
      if (dbState.ready && mongoose.isValidObjectId(profile.id)) await Presence.findOneAndUpdate({ userId: profile.id }, { socketId: socket.id, lastHeartbeatAt: record.lastHeartbeatAt }, { upsert: true })
      io.emit('presence:changed', [...memory.presence.values()])
    })
    socket.on('disconnect', () => {
      for (const [userId, entry] of memory.presence) if (entry.socketId === socket.id) memory.presence.delete(userId)
      io.emit('presence:changed', [...memory.presence.values()])
    })
  })
}
