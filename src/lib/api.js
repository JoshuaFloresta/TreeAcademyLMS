export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

// Uploaded avatars are returned as API-relative paths (e.g. /uploads/avatars/xyz.png); resolve
// them against the API origin since the client and API can run on different hosts/ports.
export const avatarSrc = (url) => (url && url.startsWith('/') ? `${API_URL}${url}` : url)

// Public — no auth — since the enrollment flow that needs it isn't signed in yet. Admin-editable
// via the "Pricing Settings" console page; falls back to catalog.js's static price server-side.
export async function fetchPricing() {
  const response = await fetch(`${API_URL}/api/pricing`)
  if (!response.ok) throw new Error('Could not load current pricing.')
  return response.json()
}
