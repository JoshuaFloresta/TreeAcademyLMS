// Set VITE_API_URL to the deployed API origin (e.g. https://treeacademy-api.onrender.com) when the
// frontend is hosted separately; it is baked in at build time, so changing it needs a redeploy.
// `||` rather than `??` so a blank value in a hosting dashboard falls back instead of producing
// same-origin URLs, and the trailing slash is stripped since every caller appends "/api/…".
export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '')

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

// Voucher codes, applied on the payment step. Public — no auth — like the rest of the enrollment
// flow, and keyed by enrollment id: the server persists the discount on the enrollment, so the
// price checkout charges is read from there rather than sent up from the browser. Both return the
// updated enrollment ({ amount, discount, … }), which is what the payment step re-renders from.
export async function applyEnrollmentVoucher(enrollmentId, code) {
  const response = await fetch(`${API_URL}/api/enrollments/${enrollmentId}/voucher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? 'That voucher could not be applied. Please try again.')
  return data
}

export async function removeEnrollmentVoucher(enrollmentId) {
  const response = await fetch(`${API_URL}/api/enrollments/${enrollmentId}/voucher`, { method: 'DELETE' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? 'That voucher could not be removed. Please try again.')
  return data
}

// The generic, no-payment application flow for a course outside the 3 fixed enrollment pathways
// (see Course.agreementTemplate / CourseEnrollment). Public — no auth — same as the pathway
// enrollment routes above.
export async function fetchCourseAgreement(slug) {
  const response = await fetch(`${API_URL}/api/course-agreements/${slug}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? 'This course is not accepting applications right now.')
  return data
}

export async function submitCourseAgreement(slug, payload) {
  const response = await fetch(`${API_URL}/api/course-agreements/${slug}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? 'We could not submit your application. Please try again.')
  return data
}

// The blank template PDF — not sensitive, so it's fetched directly by pdfjs from the API origin
// (which can differ from the client's own origin in production) rather than proxied through it.
export const courseAgreementTemplateUrl = (slug) => `${API_URL}/api/course-agreements/${slug}/template.pdf`
