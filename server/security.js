import crypto from 'node:crypto'
import { Buffer } from 'node:buffer'
import jwt from 'jsonwebtoken'
import { config } from './config.js'

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')
export const createToken = () => crypto.randomBytes(32).toString('base64url')

export function signAccessToken(user) {
  if (!config.jwtSecret) throw new Error('JWT_SECRET is required to issue access tokens')
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, config.jwtSecret, { expiresIn: '15m' })
}

export function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token || !config.jwtSecret) return res.status(401).json({ error: 'Authentication required.' })
  try {
    req.auth = jwt.verify(token, config.jwtSecret)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired access token.' })
  }
}

export const requireStaff = (req, res, next) => {
  if (!['instructor', 'admin'].includes(req.auth?.role)) return res.status(403).json({ error: 'Staff access required.' })
  next()
}

export const requireAdmin = (req, res, next) => {
  if (req.auth?.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' })
  next()
}

export function verifyHmac(rawBody, header, secret) {
  if (!secret || !header || !rawBody) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  if (header.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header))
}

export function verifyPaymongoSignature(rawBody, header, secret, livemode = false) {
  if (!secret || !header || !rawBody) return false
  const segments = Object.fromEntries(header.split(',').map((part) => part.trim().split('=')))
  const supplied = segments[livemode ? 'li' : 'te']
  const timestamp = segments.t
  if (!supplied || !timestamp) return verifyHmac(rawBody, header, secret)
  const timestampMs = Number(timestamp) * 1000
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) return false
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  if (supplied.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
}
