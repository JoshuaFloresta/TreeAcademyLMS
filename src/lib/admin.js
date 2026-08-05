import { authedFetch } from './auth.js'

async function json(response) {
  if (response.status === 204) return null
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? 'That request could not be completed. Please try again.')
  return data
}

const get = (path) => authedFetch(path).then(json)
const send = (method) => (path, body) => authedFetch(path, {
  method,
  headers: body ? { 'Content-Type': 'application/json' } : undefined,
  body: body ? JSON.stringify(body) : undefined,
}).then(json)
const post = send('POST')
const patch = send('PATCH')
const put = send('PUT')
const del = send('DELETE')

const qs = (params) => {
  const search = new URLSearchParams(Object.entries(params ?? {}).filter(([, value]) => value)).toString()
  return search ? `?${search}` : ''
}

// User management
export const fetchAdminUsers = (params) => get(`/api/admin/users${qs(params)}`)
export const createAdminUser = (body) => post('/api/admin/users', body)
export const updateAdminUser = (id, body) => patch(`/api/admin/users/${id}`, body)
export const deleteAdminUser = (id) => del(`/api/admin/users/${id}`)
export const resetAdminUserPassword = (id, password) => post(`/api/admin/users/${id}/password`, { password })
export const uploadAdminUserAvatar = async (id, file) => {
  const body = new FormData()
  body.append('avatar', file)
  return authedFetch(`/api/admin/users/${id}/avatar`, { method: 'POST', body }).then(json)
}
export const bulkUserAction = (ids, action) => post('/api/admin/users/bulk-action', { ids, action })
export const bulkEnrollUsers = (ids, courseId) => post('/api/admin/users/bulk-enroll', { ids, courseId })
export const importUsers = (rows) => post('/api/admin/users/import', { rows })
export const fetchUserCourses = (id) => get(`/api/admin/users/${id}/courses`)
export const enrollUserCourse = (id, courseId) => post(`/api/admin/users/${id}/courses`, { courseId })
export const unenrollUserCourse = (id, courseId) => del(`/api/admin/users/${id}/courses/${courseId}`)
export const fetchInstructorTeachingCourses = (id) => get(`/api/admin/users/${id}/teaching-courses`)
export const saveInstructorTeachingCourses = (id, courseIds) => put(`/api/admin/users/${id}/teaching-courses`, { courseIds })

// Catalog management
export const fetchAdminCourses = () => get('/api/admin/courses')
export const moderateCourse = (id, body) => patch(`/api/admin/courses/${id}`, body)
export const reviewCourse = (id, decision, note) => post(`/api/admin/courses/${id}/review`, { decision, note: note || undefined })
export const deleteCourse = (id) => del(`/api/admin/courses/${id}`)

// Roles & permissions
export const fetchPermissions = () => get('/api/admin/permissions')
export const savePermissions = (matrix) => put('/api/admin/permissions', matrix)

// Pricing settings — total price plus the upfront/reservation fee an applicant can pay instead
// (the fee differs by which agreement document their pathway signs).
export const fetchAdminPricing = () => get('/api/pricing')
export const updateAdminPricing = (body) => patch('/api/admin/pricing', body)

// Discount vouchers — admin-only, since a code is a lever on revenue. Redemption counts are written
// by the payment webhook, never from here, so nothing in this file can mark a voucher as used.
export const fetchVouchers = () => get('/api/admin/vouchers')
// Who redeemed a given code. Fetched per-voucher on demand rather than bundled into the list —
// these rows are applicant PII.
export const fetchVoucherRedemptions = (id) => get(`/api/admin/vouchers/${id}/redemptions`)
export const createVoucher = (body) => post('/api/admin/vouchers', body)
export const updateVoucher = (id, body) => patch(`/api/admin/vouchers/${id}`, body)
export const deleteVoucher = (id) => del(`/api/admin/vouchers/${id}`)

// Enrollment management
export const fetchAdminEnrollments = (params) => get(`/api/staff/enrollments${qs(params)}`)
export const decideEnrollment = (id, decision, reason) => post(`/api/staff/enrollments/${id}/decision`, { decision, reason: reason || undefined })
export const bulkDecideEnrollments = (ids, decision, reason) => post('/api/admin/enrollments/bulk-decision', { ids, decision, reason: reason || undefined })
export const archiveEnrollment = (id, archived) => post(`/api/admin/enrollments/${id}/archive`, { archived })
// The reminder shown on the learner's own Statement of Account for what they still owe on a "pay
// upfront only" plan — purely informational, not an in-app payment collector.
export const setEnrollmentBalanceDue = (id, body) => patch(`/api/staff/enrollments/${id}/balance-due`, body)

// Billing — the Payment ledger. A payment is never deleted, only voided, so there is no del() here.
export const fetchStaffBilling = () => get('/api/staff/billing')
export const createBillingRecord = (body) => post('/api/staff/billing/enrollments', body)
export const updateEnrollmentBilling = (id, body) => patch(`/api/staff/enrollments/${id}/billing`, body)
export const fetchEnrollmentPayments = (id) => get(`/api/staff/enrollments/${id}/payments`)
export const recordPayment = (id, body) => post(`/api/staff/enrollments/${id}/payments`, body)
export const updatePayment = (id, body) => patch(`/api/staff/payments/${id}`, body)
export const voidPayment = (id, reason) => post(`/api/staff/payments/${id}/void`, { reason })

// Submitted admission forms and signed agreements. The server streams the bytes rather than
// handing out a URL, so this goes through authedFetch and becomes a local blob — which also lets
// the caller decide between opening it in a tab and saving it, from the same single request.
export async function fetchEnrollmentDocument(id, type) {
  const response = await authedFetch(`/api/staff/enrollments/${id}/documents/${type}`)
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'That document could not be opened.')
  return URL.createObjectURL(await response.blob())
}

export async function openEnrollmentDocument(id, type) {
  const url = await fetchEnrollmentDocument(id, type)
  window.open(url, '_blank', 'noopener')
  // Revoked on a delay, not immediately: the new tab needs the URL to still resolve when it loads.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export async function downloadEnrollmentDocument(id, type, filename) {
  const url = await fetchEnrollmentDocument(id, type)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

// Mirrors the naming the server gives the same file in its Content-Disposition header, so the
// saved copy reads the same whether staff opened it via /documents/:type or downloaded it here.
export const enrollmentDocumentFilename = (applicantName, type) =>
  `${(applicantName || 'applicant').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')}-${type}.pdf`

// Applicants for a generic (non-pathway) course's uploaded agreement PDF — see CourseEnrollment.
export async function openCourseAgreementDocument(courseEnrollmentId) {
  const response = await authedFetch(`/api/staff/course-enrollments/${courseEnrollmentId}/document`)
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'That document could not be opened.')
  const url = URL.createObjectURL(await response.blob())
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// Audit logs
export const fetchAuditLogs = (params) => get(`/api/admin/audit-logs${qs(params)}`)

// Content library
export const fetchContentAssets = () => get('/api/admin/content-assets')
export const createContentAsset = (body) => post('/api/admin/content-assets', body)
export const deleteContentAsset = (id) => del(`/api/admin/content-assets/${id}`)

// Support / helpdesk
export const fetchSupportTickets = (params) => get(`/api/admin/support/tickets${qs(params)}`)
export const updateSupportTicket = (id, body) => patch(`/api/admin/support/tickets/${id}`, body)

// Reports
export const fetchReports = (params) => get(`/api/admin/reports${qs(params)}`)
export const updateReport = (id, body) => patch(`/api/admin/reports/${id}`, body)

// Analytics
export const fetchAnalytics = () => get('/api/admin/analytics')
export const fetchAdminDashboard = () => get('/api/admin/dashboard')

// Webinars / special courses
export const fetchAdminWebinars = () => get('/api/admin/webinars')
export const createWebinar = (body) => post('/api/admin/webinars', body)
export const updateWebinar = (id, body) => patch(`/api/admin/webinars/${id}`, body)
export const deleteWebinar = (id) => del(`/api/admin/webinars/${id}`)
export const fetchWebinarRegistrations = (id) => get(`/api/admin/webinars/${id}/registrations`)

// Email automation
export const fetchEmailTemplates = () => get('/api/admin/email-templates')
// Sends one template to a real inbox with stand-in data. Blank `to` means the signed-in admin's own
// address. Sends the SAVED template, not unsaved editor content.
export const sendTestEmail = (key, to) => post(`/api/admin/email-templates/${key}/test`, { to: to || undefined })
export const updateEmailTemplate = (key, body) => patch(`/api/admin/email-templates/${key}`, body)

// Permission catalogue shown in the Roles & Permissions matrix.
export const PERMISSION_CATALOG = [
  { key: 'courses.view', label: 'View courses' },
  { key: 'courses.manage', label: 'Create & edit courses' },
  { key: 'assignments.submit', label: 'Submit assignments' },
  { key: 'assignments.grade', label: 'Grade assignments' },
  { key: 'quizzes.attempt', label: 'Attempt quizzes' },
  { key: 'quizzes.manage', label: 'Manage quizzes' },
  { key: 'certificates.view', label: 'View certificates' },
  { key: 'enrollments.review', label: 'Review enrollments' },
  { key: 'enrollments.manage', label: 'Manage enrollments' },
  { key: 'recognition.award', label: 'Award recognition' },
  { key: 'support.submit', label: 'Submit support tickets' },
  { key: 'support.manage', label: 'Manage support tickets' },
  { key: 'reports.submit', label: 'Submit reports' },
  { key: 'reports.manage', label: 'Manage reports' },
  { key: 'users.manage', label: 'Manage users' },
  { key: 'catalog.manage', label: 'Moderate catalog' },
  { key: 'roles.manage', label: 'Manage roles & permissions' },
  { key: 'audit.view', label: 'View audit logs' },
  { key: 'content.manage', label: 'Manage content library' },
  { key: 'analytics.view', label: 'View global analytics' },
]
