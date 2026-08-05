import express from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { config } from '../config.js'
import { User, RefreshToken } from '../models.js'
import { createToken, hashToken, requireAuth } from '../security.js'
import { dbState } from '../state.js'
import { asyncRoute } from '../lib/http.js'
import { cookieOptions, issueSession, sessionUser } from '../lib/session.js'
import { bestEffortEmail, issueAccountSetupUrl, sendPasswordResetEmail } from '../lib/accounts.js'
import { saveAudit } from '../lib/audit.js'

export const router = express.Router()

// Login must accept any stored password and let bcrypt decide — the 10-char minimum is an
// account-creation policy, not a sign-in gate. Enforcing it here just turns a wrong password
// into a confusing "check the highlighted fields" 422 instead of "email or password is incorrect".
const loginInput = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) })
// Activation identifies the account by the setup token alone (POST /api/auth/activate looks the
// user up via inviteTokenHash) — no email field, since the client has no reason to send one.
const activationInput = z.object({ token: z.string().min(20).max(200), password: z.string().min(10).max(128) })
const forgotPasswordInput = z.object({ email: z.string().email().max(254) })
const passwordChangeInput = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(10).max(128) })

// Deliberately does not sign the learner in (no issueSession/refresh cookie) — the learner lands on
// the plain sign-in page after this and signs in with the password they just chose, as a genuine
// end-to-end check that it works, rather than being carried straight into the dashboard.
router.post('/api/auth/activate', asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Account activation requires MongoDB.' })
  const { token, password } = activationInput.parse(req.body)
  const user = await User.findOne({ inviteTokenHash: hashToken(token), inviteExpiresAt: { $gt: new Date() } })
  if (!user) return res.status(400).json({ error: 'This account-setup link is invalid or expired.' })
  user.passwordHash = await bcrypt.hash(password, 12)
  user.status = 'active'
  user.inviteTokenHash = undefined
  user.inviteExpiresAt = undefined
  await user.save()
  await saveAudit('user.activated', 'User', user.id)
  res.status(200).json({ activated: true, email: user.email })
}))

// Always answers 200 with the same body whether or not the address is registered — a differing
// response here would turn this into an account-enumeration oracle. The reset link is the same
// one-time token issueAccountSetupUrl mints, so POST /api/auth/activate consumes it unchanged.
router.post('/api/auth/forgot-password', asyncRoute(async (req, res) => {
  const { email } = forgotPasswordInput.parse(req.body)
  const sent = { sent: true }
  if (!dbState.ready) return res.json(sent)
  const user = await User.findOne({ email: email.toLowerCase() })
  // Suspended/inactive accounts are deliberately excluded — a reset would otherwise let a
  // deactivated account be reactivated, since /api/auth/activate sets status back to active.
  if (!user || !['active', 'invited'].includes(user.status)) return res.json(sent)
  const resetUrl = await issueAccountSetupUrl(user)
  await bestEffortEmail(sendPasswordResetEmail({ name: user.name, email: user.email, resetUrl }), 'password_reset email')
  await saveAudit('user.password_reset_requested', 'User', user.id)
  res.json(sent)
}))

router.post('/api/auth/login', asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Sign-in requires MongoDB.' })
  const { email, password } = loginInput.parse(req.body)
  const user = await User.findOne({ email: email.toLowerCase() })
  if (!user || user.status !== 'active' || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect.' })
  user.lastSeenAt = new Date()
  await user.save()
  const accessToken = await issueSession(res, user)
  res.json({ accessToken, user: sessionUser(user) })
}))

router.post('/api/auth/refresh', asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Session refresh requires MongoDB.' })
  const token = req.cookies.treeacademy_refresh
  if (!token) return res.status(401).json({ error: 'Refresh token required.' })
  const record = await RefreshToken.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } })
  if (!record) return res.status(401).json({ error: 'Refresh token is invalid or expired.' })
  const user = await User.findById(record.userId)
  await RefreshToken.deleteOne({ _id: record._id })
  if (!user || user.status !== 'active') return res.status(401).json({ error: 'Account is inactive.' })
  // Preserve an in-progress impersonation across token rotation so the admin stays in the target's view.
  const impersonator = record.impersonatorId ? await User.findById(record.impersonatorId).select('name role') : null
  const accessToken = await issueSession(res, user, impersonator?._id ?? null)
  res.json({ accessToken, user: sessionUser(user, impersonator ? { impersonating: true, impersonatorName: impersonator.name } : {}) })
}))

router.post('/api/auth/logout', asyncRoute(async (req, res) => {
  if (dbState.ready && req.cookies.treeacademy_refresh) await RefreshToken.deleteOne({ tokenHash: hashToken(req.cookies.treeacademy_refresh) })
  res.clearCookie('treeacademy_refresh', cookieOptions({ path: '/api/auth' }))
  res.status(204).end()
}))

router.post('/api/auth/stop-impersonation', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Impersonation requires MongoDB.' })
  const token = req.cookies.treeacademy_refresh
  const record = token ? await RefreshToken.findOne({ tokenHash: hashToken(token) }) : null
  if (!record?.impersonatorId) return res.status(400).json({ error: 'This session is not an impersonation.' })
  const admin = await User.findOne({ _id: record.impersonatorId, status: 'active' })
  if (!admin) return res.status(403).json({ error: 'The original account is no longer available.' })
  await RefreshToken.deleteOne({ _id: record._id })
  const accessToken = await issueSession(res, admin)
  await saveAudit('user.impersonation_ended', 'User', record.userId.toString(), {}, admin.id)
  res.json({ accessToken, user: sessionUser(admin) })
}))

router.post('/api/auth/change-password', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Password changes require MongoDB.' })
  const { currentPassword, newPassword } = passwordChangeInput.parse(req.body)
  const user = await User.findById(req.auth.sub)
  if (!user?.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) return res.status(401).json({ error: 'Your current password is incorrect.' })
  user.passwordHash = await bcrypt.hash(newPassword, 12)
  await user.save()
  await RefreshToken.deleteMany({ userId: user._id })
  await saveAudit('user.password_changed', 'User', user.id, {}, user.id)
  res.clearCookie('treeacademy_refresh', cookieOptions({ path: '/api/auth' }))
  res.status(204).end()
}))

router.get('/api/auth/google', (_req, res) => {
  if (!config.google.clientId || !config.google.clientSecret) return res.status(503).json({ error: 'Google sign-in is not configured.' })
  const state = createToken()
  res.cookie('treeacademy_google_state', state, cookieOptions({ maxAge: 10 * 60 * 1000, path: '/api/auth/google' }))
  const query = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
  })
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${query}`)
})

router.get('/api/auth/google/callback', asyncRoute(async (req, res) => {
  const failure = (reason) => res.redirect(`${config.clientUrl}/auth?oauth=${encodeURIComponent(reason)}`)
  if (!dbState.ready || !config.google.clientId || !config.google.clientSecret || !req.query.code || req.query.state !== req.cookies.treeacademy_google_state) return failure('unavailable')
  res.clearCookie('treeacademy_google_state', cookieOptions({ path: '/api/auth/google' }))
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: req.query.code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: config.google.redirectUri, grant_type: 'authorization_code' }),
  })
  if (!tokenResponse.ok) return failure('denied')
  const tokens = await tokenResponse.json()
  const identityResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`)
  if (!identityResponse.ok) return failure('identity')
  const identity = await identityResponse.json()
  if (identity.aud !== config.google.clientId || identity.email_verified !== 'true') return failure('identity')
  const user = await User.findOne({ email: identity.email.toLowerCase() })
  if (!user || user.status === 'suspended') return failure('not-approved')
  user.googleSubject = identity.sub
  if (user.status === 'invited') {
    user.status = 'active'
    user.inviteTokenHash = undefined
    user.inviteExpiresAt = undefined
  }
  await user.save()
  await issueSession(res, user)
  await saveAudit('user.google_signed_in', 'User', user.id)
  res.redirect(`${config.clientUrl}/dashboard?oauth=success`)
}))
