import { RefreshToken } from '../models.js'
import { createToken, hashToken, signAccessToken } from '../security.js'
import { isProduction } from '../config.js'

// When the client is hosted on a different site than the API (e.g. Vercel frontend + Render API),
// `SameSite=Lax` makes the browser withhold this cookie on cross-site XHR — sign-in appears to
// work but the session dies on the first refresh. `None` restores it, and requires `Secure`,
// which is why it only applies in production (localhost dev stays on Lax over plain HTTP).
export const cookieOptions = (extra = {}) => ({ httpOnly: true, secure: isProduction, sameSite: isProduction ? 'none' : 'lax', ...extra })

export function refreshCookie(res, token) {
  res.cookie('treeacademy_refresh', token, cookieOptions({ maxAge: 1000 * 60 * 60 * 24 * 14, path: '/api/auth' }))
}

export async function issueSession(res, user, impersonatorId = null) {
  const refreshToken = createToken()
  await RefreshToken.create({ userId: user._id, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14), impersonatorId })
  refreshCookie(res, refreshToken)
  return signAccessToken(user)
}

export const sessionUser = (user, extra = {}) => ({ id: user.id, name: user.name, email: user.email, role: user.role, avatarUrl: user.avatarUrl, ...extra })
