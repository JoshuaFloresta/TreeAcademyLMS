import { API_URL } from './api.js'

async function responseData(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? 'Dev enrollment shortcut failed.')
  return data
}

const post = async (path) => responseData(await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }))

// Dev-only: fast-forwards a throwaway enrollment through the real backend state machine
// (application_pending -> documents_pending -> payment_pending) so the enrollment flow can be
// exercised from step 2 or 3 without re-filling the admission form on every reload.
export async function createDevEnrollmentAt(targetStep, pathwayId) {
  const name = 'Dev Tester'
  const email = `dev+${Date.now()}@treeacademy.test`
  const phone = '+63 917 000 0000'

  const record = await responseData(await fetch(`${API_URL}/api/enrollments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, phone, pathway: pathwayId }),
  }))

  const { intake } = await post(`/api/enrollments/${record.id}/demo/complete-application`)
  if (targetStep === 3) await post(`/api/enrollments/${record.id}/demo/complete-documents`)

  return { id: record.id, name, email, phone, amount: record.amount, currency: record.currency, step: targetStep, intake }
}
