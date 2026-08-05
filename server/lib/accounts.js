import { config } from '../config.js'
import { createToken, hashToken } from '../security.js'
import { sendTemplatedEmail } from '../email.js'

const ACCOUNT_SETUP_WINDOW_MS = 72 * 60 * 60 * 1000

// Issues a one-time setup link (instead of emailing a plaintext temp password) so a newly
// provisioned learner sets their own password on first login — consumed by POST /api/auth/activate.
export async function issueAccountSetupUrl(user) {
  const token = createToken()
  user.inviteTokenHash = hashToken(token)
  user.inviteExpiresAt = new Date(Date.now() + ACCOUNT_SETUP_WINDOW_MS)
  await user.save()
  return `${config.clientUrl}/auth?mode=activate&token=${token}`
}

// Admin-customizable via the "enrollment_credentials" template (Settings > Email Automation) —
// used whenever a learner account is created: on payment confirmation (see markEnrollmentPaid) and
// when staff create/import a user directly. setupUrl is null for an already-active account (no
// first-time setup needed) — sendPaymentReceiptEmail falls back to the plain login page in that case.
export const sendCredentialsEmail = ({ name, email, setupUrl, pathway }) => sendTemplatedEmail('enrollment_credentials', email, { name, email, pathway: pathway ?? 'Tree Academy', setupUrl: setupUrl ?? `${config.clientUrl}/auth`, loginUrl: `${config.clientUrl}/auth` })

// Self-service reset for anyone who already has an account — the enrollment flow only ever issues a
// setup link for a brand-new account (provisionLearnerAccount returns early for an already-active
// one), so without this there is no way back in for an existing learner who forgets their password.
export const sendPasswordResetEmail = ({ name, email, resetUrl }) => sendTemplatedEmail('password_reset', email, { name, email, resetUrl, loginUrl: `${config.clientUrl}/auth` })

// Notification/receipt emails must never fail the request that triggered them (account creation,
// document signing, payment confirmation) — the underlying record is already saved by the time we
// send. A rejected/misconfigured email provider should only affect delivery, never the operation.
export async function bestEffortEmail(promise, label) {
  try {
    return await promise
  } catch (error) {
    console.error(`${label} failed:`, error.message)
    return { delivery: 'failed' }
  }
}
