import { API_URL } from './api.js'

// In-memory session. The refresh token lives in an httpOnly cookie (path /api/auth);
// the short-lived access token is held here and attached to protected requests.
let accessToken = null
let currentUser = null
let lastAuthReason = null
let lastAuthStatus = 'loading'

const SESSION_HINT_KEY = 'treeacademy_has_session'

export function hasSessionHint() {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) === '1'
  } catch {
    return false
  }
}

export function setSessionHint(hasSession) {
  try {
    if (hasSession) {
      localStorage.setItem(SESSION_HINT_KEY, '1')
    } else {
      localStorage.removeItem(SESSION_HINT_KEY)
    }
  } catch {
    // Ignore environments with restricted storage
  }
}

export function getLastAuthReason() {
  return lastAuthReason
}

export function getLastAuthStatus() {
  return lastAuthStatus
}

const authListeners = new Set()

export function subscribeAuth(listener) {
  authListeners.add(listener)
  return () => authListeners.delete(listener)
}

function notifyAuth(user, reason = null) {
  for (const listener of authListeners) {
    try { listener(user, reason) } catch (err) { console.error('Auth listener error:', err) }
  }
}

export function getAccessToken() { return accessToken }
export function getCurrentUser() { return currentUser }

function setSession(result) {
  accessToken = result?.accessToken ?? null
  currentUser = result?.user ?? null
  if (currentUser) {
    setSessionHint(true)
    lastAuthReason = null
    lastAuthStatus = 'authenticated'
  } else {
    setSessionHint(false)
    lastAuthStatus = 'unauthenticated'
  }
  notifyAuth(currentUser, lastAuthReason)
  return currentUser
}

async function postJson(path, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'We could not complete that request. Please try again.')
  return result
}

export async function login(email, password) {
  return setSession(await postJson('/api/auth/login', { email, password }))
}

// Deliberately does not establish a session — the server no longer issues one for this route, so
// the learner lands on the plain sign-in page and signs in with the password they just chose.
export async function activate(token, password) {
  return postJson('/api/auth/activate', { token, password })
}

// Resolves the same way whether or not the address is registered (the server never reveals which),
// so the caller must show a neutral "if that address has an account, check your email" message.
export async function requestPasswordReset(email) {
  return postJson('/api/auth/forgot-password', { email })
}

/**
 * Checks authentication session with explicit status:
 * - 'authenticated': Session restored successfully
 * - 'unauthenticated': No session exists or token is invalid/expired
 * - 'error': Server temporarily unavailable / network timeout
 */
export async function checkAuthSession() {
  // If the browser storage explicitly indicates no active session exists, skip the network
  // request entirely. This guarantees instant (0ms) redirection to login for logged-out users.
  if (!hasSessionHint()) {
    accessToken = null
    currentUser = null
    lastAuthReason = lastAuthReason || 'logged_out'
    lastAuthStatus = 'unauthenticated'
    return { status: 'unauthenticated', user: null, reason: lastAuthReason }
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeoutId = controller ? setTimeout(() => controller.abort(), 4000) : null

  try {
    const response = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      signal: controller?.signal,
    })
    if (timeoutId) clearTimeout(timeoutId)

    if (response.status === 401) {
      accessToken = null
      currentUser = null
      setSessionHint(false)
      lastAuthReason = 'expired'
      lastAuthStatus = 'unauthenticated'
      return { status: 'unauthenticated', user: null, reason: 'expired' }
    }

    if (!response.ok) {
      // 5xx / 503 / 502: server is restarting or down; do NOT clear session hint.
      lastAuthStatus = 'error'
      return { status: 'error', user: null, error: `Server temporarily unavailable (${response.status})` }
    }

    const data = await response.json().catch(() => ({}))
    const user = setSession(data)
    lastAuthStatus = 'authenticated'
    return { status: 'authenticated', user }
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId)
    lastAuthStatus = 'error'
    const errorMsg = err?.name === 'AbortError' ? 'Connection timed out.' : 'Network connection unavailable.'
    return { status: 'error', user: null, error: errorMsg }
  }
}

export async function refreshSession() {
  const result = await checkAuthSession()
  return result.user
}

// Impersonation swaps the in-memory session (and refresh cookie) to the target user. The refresh
// token stores who started it, so stopImpersonation restores the admin without re-authenticating.
export async function startImpersonation(userId) {
  const response = await authedFetch(`/api/admin/users/${userId}/impersonate`, { method: 'POST' })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Could not impersonate that user.')
  return setSession(result)
}

export async function stopImpersonation() {
  const response = await authedFetch('/api/auth/stop-impersonation', { method: 'POST' })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Could not exit impersonation.')
  return setSession(result)
}

export async function logout() {
  setSessionHint(false)
  lastAuthReason = 'logged_out'
  lastAuthStatus = 'unauthenticated'
  accessToken = null
  currentUser = null

  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), 3000) : null
    await fetch(`${API_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      signal: controller?.signal,
    })
    if (timer) clearTimeout(timer)
  } catch { /* ignore network error on logout */ }

  notifyAuth(null, 'logged_out')
}

// fetch wrapper that attaches the bearer token and transparently refreshes once on a 401.
export async function authedFetch(path, options = {}, retry = true) {
  const url = path.startsWith('http') ? path : `${API_URL}${path}`
  const headers = { ...(options.headers || {}) }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const response = await fetch(url, { ...options, credentials: 'include', headers })
  if (response.status === 401) {
    if (retry) {
      const refreshed = await refreshSession()
      if (refreshed) return authedFetch(path, options, false)
    }
    // If retry is false or refreshSession failed, the credentials are truly invalid/expired
    accessToken = null
    currentUser = null
    setSessionHint(false)
    lastAuthReason = 'expired'
    lastAuthStatus = 'unauthenticated'
    notifyAuth(null, 'expired')
  }
  return response
}
