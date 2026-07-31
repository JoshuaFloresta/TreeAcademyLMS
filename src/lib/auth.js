import { API_URL } from './api.js'

// In-memory session. The refresh token lives in an httpOnly cookie (path /api/auth);
// the short-lived access token is held here and attached to protected requests.
let accessToken = null
let currentUser = null

export function getAccessToken() { return accessToken }
export function getCurrentUser() { return currentUser }

function setSession(result) {
  accessToken = result?.accessToken ?? null
  currentUser = result?.user ?? null
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

export async function refreshSession() {
  try {
    const response = await fetch(`${API_URL}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
    if (!response.ok) { accessToken = null; currentUser = null; return null }
    return setSession(await response.json().catch(() => ({})))
  } catch {
    accessToken = null; currentUser = null; return null
  }
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
  try { await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' }) } catch { /* ignore */ }
  accessToken = null
  currentUser = null
}

// fetch wrapper that attaches the bearer token and transparently refreshes once on a 401.
export async function authedFetch(path, options = {}, retry = true) {
  const url = path.startsWith('http') ? path : `${API_URL}${path}`
  const headers = { ...(options.headers || {}) }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const response = await fetch(url, { ...options, credentials: 'include', headers })
  if (response.status === 401 && retry && await refreshSession()) return authedFetch(path, options, false)
  return response
}
