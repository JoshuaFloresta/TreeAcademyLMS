import http from 'node:http'
import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { Server } from 'socket.io'
import { z } from 'zod'
import { config, isAllowedOrigin, isProduction } from './config.js'
import { ensureDefaultEmailTemplates } from './email.js'
import { isObjectStorage } from './storage.js'
import { dbState } from './state.js'
import { router as uploadsStaticRouter } from './routes/uploads-static.js'
import { router as authRouter } from './routes/auth.js'
import { router as usersRouter } from './routes/users.js'
import { router as enrollmentRouter } from './routes/enrollment.js'
import { router as adminVouchersRouter } from './routes/admin-vouchers.js'
import { router as billingRouter } from './routes/billing.js'
import { router as webhooksRouter } from './routes/webhooks.js'
import { router as adminUsersRouter } from './routes/admin-users.js'
import { router as adminCatalogRouter } from './routes/admin-catalog.js'
import { router as coursesRouter } from './routes/courses.js'
import { router as assignmentsRouter } from './routes/assignments.js'
import { router as quizzesRouter } from './routes/quizzes.js'
import { router as commentsRouter } from './routes/comments.js'
import { router as badgesRouter } from './routes/badges.js'
import { router as staffDashboardRouter } from './routes/staff-dashboard.js'
import { router as forumsRouter } from './routes/forums.js'
import { router as calendarRouter } from './routes/calendar.js'
import { router as miscRouter } from './routes/misc.js'
import { router as presenceRouter, registerPresenceSocket } from './routes/presence.js'

const app = express()
const server = http.createServer(app)
// Socket.IO shares the HTTP CORS allow-list so the presence socket works from the same origins
// the REST API does — including per-deploy preview URLs.
const io = new Server(server, { cors: { origin: (origin, callback) => callback(null, isAllowedOrigin(origin)), credentials: true } })

app.set('trust proxy', 1)
app.use(helmet({ crossOriginResourcePolicy: false }))
// See isAllowedOrigin in config.js — the same allow-list guards the Socket.IO handshake above.
app.use(cors({ origin: (origin, callback) => callback(null, isAllowedOrigin(origin)), credentials: true }))
app.use(cookieParser())
app.use(express.json({ limit: '1mb', verify: (req, _res, buffer) => { req.rawBody = buffer } }))
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 250, standardHeaders: 'draft-8', legacyHeaders: false }))

app.use(uploadsStaticRouter)
app.use(authRouter)
app.use(usersRouter)
app.use(enrollmentRouter)
app.use(adminVouchersRouter)
app.use(billingRouter)
app.use(webhooksRouter)
app.use(adminUsersRouter)
app.use(adminCatalogRouter)
app.use(coursesRouter)
app.use(assignmentsRouter)
app.use(quizzesRouter)
app.use(commentsRouter)
app.use(badgesRouter)
app.use(staffDashboardRouter)
app.use(forumsRouter)
app.use(calendarRouter)
app.use(miscRouter)
app.use(presenceRouter)

registerPresenceSocket(io)

app.use((error, _req, res, next) => {
  void next
  if (error instanceof z.ZodError) return res.status(422).json({ error: 'Please check the highlighted fields.', issues: error.issues })
  // A route can raise a deliberate client-facing error via httpError(). `expose` is required as
  // well as `status` so that an internal error which happens to carry a `status` property can never
  // leak its message — anything unmarked still becomes a generic 500.
  if (error?.expose === true && Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: error.message })
  }
  // A malformed :id (anything that isn't a valid ObjectId) makes Mongoose throw before the route can
  // return its own 404. That is a client error, not a server fault — answering 500 and logging a
  // stack trace for every mistyped URL buries real failures in noise.
  if (error?.name === 'CastError' && error.kind === 'ObjectId') return res.status(404).json({ error: 'Not found.' })
  console.error(error)
  res.status(500).json({ error: 'Unexpected server error.' })
})

async function boot() {
  if (config.mongoUri) {
    await mongoose.connect(config.mongoUri)
    dbState.ready = true
    await ensureDefaultEmailTemplates()
    console.log('MongoDB connected')
  } else if (isProduction) {
    throw new Error('MONGODB_URI is required in production.')
  } else {
    console.warn('MONGODB_URI is not set. Running with development-only in-memory records.')
  }
  // Managed hosts (Render, Vercel, Fly) give each instance an ephemeral filesystem, so anything
  // written to disk — including signed enrollment agreements and certificates — disappears on the
  // next restart or redeploy. Refuse to start rather than silently destroy legal records.
  if (isProduction && !isObjectStorage) {
    throw new Error('S3_BUCKET/S3_ACCESS_KEY_ID are required in production: local disk storage would lose signed agreements and certificates on every redeploy.')
  }
  console.log(isObjectStorage ? `File storage: S3 bucket "${config.storage.s3.bucket}"` : `File storage: local disk (${config.storage.privateDirectory})`)
  server.listen(config.port, () => console.log(`Tree Academy API listening on :${config.port}`))
}

boot().catch((error) => { console.error(error); process.exit(1) })
