import { authedFetch } from './auth.js'

async function json(response) {
  if (response.status === 204) return null
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error ?? 'That request could not be completed. Please try again.')
    error.status = response.status
    throw error
  }
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
export const sendUserSetupEmail = (id, body = {}) => post(`/api/admin/users/${id}/send-setup-email`, body)
export const fetchUserSetupEmailPreview = (id, customNote) => get(`/api/admin/users/${id}/setup-email-preview${customNote ? `?customNote=${encodeURIComponent(customNote)}` : ''}`)
export const bulkSendUserSetupEmail = (body) => post('/api/admin/users/bulk-send-setup-email', body)
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

// User roles
export const fetchAdminRoles = () => get('/api/admin/roles')
export const createAdminRole = (name) => post('/api/admin/roles', { name })
export const deleteAdminRole = (role) => del(`/api/admin/roles/${encodeURIComponent(role)}`)

// Billing — the Payment ledger.
export const fetchStaffBilling = () => get('/api/staff/billing')
export const createBillingRecord = (body) => post('/api/staff/billing/enrollments', body)
export const deleteBillingRecord = (id) => del(`/api/staff/billing/enrollments/${id}`)
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
export const uploadWebinarCover = async (file) => {
  const body = new FormData()
  body.append('cover', file)
  return authedFetch('/api/admin/webinars/cover', { method: 'POST', body }).then(json)
}

// Blog
export const fetchAdminBlogPosts = () => get('/api/admin/blog')
export const createBlogPost = (body) => post('/api/admin/blog', body)
export const updateBlogPost = (id, body) => patch(`/api/admin/blog/${id}`, body)
export const deleteBlogPost = (id) => del(`/api/admin/blog/${id}`)
export const uploadBlogCover = async (file) => {
  const body = new FormData()
  body.append('cover', file)
  return authedFetch('/api/admin/blog/cover', { method: 'POST', body }).then(json)
}

// Email automation
export const fetchEmailTemplates = () => get('/api/admin/email-templates')
// Sends one template to a real inbox with stand-in data. Blank `to` means the signed-in admin's own
// address. Sends the SAVED template, not unsaved editor content.
export const sendTestEmail = (key, to) => post(`/api/admin/email-templates/${key}/test`, { to: to || undefined })
export const updateEmailTemplate = (key, body) => patch(`/api/admin/email-templates/${key}`, body)

// Permission catalogue shown in the Roles & Permissions matrix, organized by system module.
export const PERMISSION_MODULES = [
  'General & Platform',
  'User Management',
  'Courses & Builder',
  'Assignments & Quizzes',
  'Classroom & Roster',
  'Enrollments & Admissions',
  'Billing & Finance',
  'Community & Discussions',
  'Certificates & Badges',
  'Webinars & Special Courses',
  'Content & Marketing',
  'Support & Governance',
]

export const PERMISSION_CATALOG = [
  // General & Platform
  { key: 'dashboard.view', label: 'View LMS Dashboard', module: 'General & Platform' },
  { key: 'settings.manage', label: 'Manage Platform & Account Settings', module: 'General & Platform' },

  // User Management
  { key: 'users.view', label: 'View user directory & profiles', module: 'User Management' },
  { key: 'users.manage', label: 'Create, edit & manage users', module: 'User Management' },
  { key: 'roles.manage', label: 'Manage roles & permissions matrix', module: 'User Management' },

  // Courses & Builder
  { key: 'courses.view', label: 'View courses & curriculum', module: 'Courses & Builder' },
  { key: 'courses.manage', label: 'Create & edit courses & modules', module: 'Courses & Builder' },
  { key: 'catalog.manage', label: 'Moderate & price public catalog', module: 'Courses & Builder' },

  // Assignments & Quizzes
  { key: 'assignments.submit', label: 'Submit student assignments', module: 'Assignments & Quizzes' },
  { key: 'assignments.grade', label: 'Grade assignments & feedback', module: 'Assignments & Quizzes' },
  { key: 'quizzes.attempt', label: 'Attempt quizzes & examinations', module: 'Assignments & Quizzes' },
  { key: 'quizzes.manage', label: 'Author quizzes, questions & passing scores', module: 'Assignments & Quizzes' },
  { key: 'submissions.view', label: 'View submissions queue', module: 'Assignments & Quizzes' },
  { key: 'submissions.grade', label: 'Grade submissions and mark completion', module: 'Assignments & Quizzes' },

  // Classroom & Roster
  { key: 'roster.view', label: 'View student class rosters', module: 'Classroom & Roster' },
  { key: 'roster.manage', label: 'Manage class roster enrollments', module: 'Classroom & Roster' },
  { key: 'attendance.view', label: 'View course attendance records', module: 'Classroom & Roster' },
  { key: 'attendance.manage', label: 'Take & update student attendance', module: 'Classroom & Roster' },

  // Enrollments & Admissions
  { key: 'enrollments.review', label: 'Review & approve/reject applications', module: 'Enrollments & Admissions' },
  { key: 'enrollments.manage', label: 'Manage student enrollments & pathways', module: 'Enrollments & Admissions' },
  { key: 'enrollments.documents', label: 'View & download enrollment agreements & IDs', module: 'Enrollments & Admissions' },

  // Billing & Finance
  { key: 'billing.view', label: 'View billing ledger & balances', module: 'Billing & Finance' },
  { key: 'billing.manage', label: 'Create billing, record & void payments', module: 'Billing & Finance' },
  { key: 'statement.view', label: 'View Statement of Account', module: 'Billing & Finance' },
  { key: 'vouchers.manage', label: 'Create & manage discount vouchers', module: 'Billing & Finance' },

  // Community & Discussions
  { key: 'announcements.view', label: 'View academy announcements', module: 'Community & Discussions' },
  { key: 'announcements.create', label: 'Create & broadcast announcements', module: 'Community & Discussions' },
  { key: 'forums.participate', label: 'Participate in forums & discussions', module: 'Community & Discussions' },
  { key: 'forums.moderate', label: 'Moderate discussion topics & replies', module: 'Community & Discussions' },
  { key: 'calendar.view', label: 'View learning calendar & events', module: 'Community & Discussions' },
  { key: 'calendar.manage', label: 'Schedule & modify calendar events', module: 'Community & Discussions' },

  // Certificates & Badges
  { key: 'certificates.view', label: 'View earned completion certificates', module: 'Certificates & Badges' },
  { key: 'certificates.issue', label: 'Issue & revoke course certificates', module: 'Certificates & Badges' },
  { key: 'recognition.view', label: 'View student badges & honors', module: 'Certificates & Badges' },
  { key: 'recognition.award', label: 'Award student badges & recognition', module: 'Certificates & Badges' },

  // Webinars & Special Courses
  { key: 'webinars.view', label: 'View special courses & webinars', module: 'Webinars & Special Courses' },
  { key: 'webinars.manage', label: 'Create & manage webinars & registrations', module: 'Webinars & Special Courses' },

  // Content & Marketing
  { key: 'blog.view', label: 'Read blog posts', module: 'Content & Marketing' },
  { key: 'blog.manage', label: 'Publish & manage academy blog articles', module: 'Content & Marketing' },
  { key: 'email_automation.manage', label: 'Configure email automation templates', module: 'Content & Marketing' },
  { key: 'content.view', label: 'Browse shared content library', module: 'Content & Marketing' },
  { key: 'content.manage', label: 'Upload & manage content assets', module: 'Content & Marketing' },

  // Support & Governance
  { key: 'support.submit', label: 'Submit support tickets', module: 'Support & Governance' },
  { key: 'support.manage', label: 'Manage & resolve helpdesk tickets', module: 'Support & Governance' },
  { key: 'reports.submit', label: 'Submit incident & flag reports', module: 'Support & Governance' },
  { key: 'reports.manage', label: 'Review & resolve submitted reports', module: 'Support & Governance' },
  { key: 'analytics.view', label: 'View global analytics & metrics', module: 'Support & Governance' },
  { key: 'audit.view', label: 'View security audit logs', module: 'Support & Governance' },
]

export const ROLE_PRESETS = [
  {
    id: 'superadmin',
    name: 'Full Administrator (All Access)',
    description: 'Unrestricted access to all modules, financial ledgers, system settings, and user management.',
    permissions: PERMISSION_CATALOG.map((p) => p.key),
  },
  {
    id: 'instructor',
    name: 'Academic Instructor / Teacher',
    description: 'Course authoring, grading submissions, student roster, attendance, forums, and badges.',
    permissions: [
      'courses.view', 'courses.manage', 'assignments.grade', 'quizzes.manage',
      'submissions.view', 'submissions.grade', 'roster.view', 'attendance.view', 'attendance.manage',
      'enrollments.review', 'recognition.view', 'recognition.award', 'announcements.view',
      'announcements.create', 'forums.participate', 'calendar.view', 'calendar.manage',
      'support.submit', 'reports.submit', 'content.view',
    ],
  },
  {
    id: 'registrar',
    name: 'Registrar / Admissions Officer',
    description: 'Student admissions, enrollment paperwork review, pathway approval, and user records.',
    permissions: [
      'dashboard.view', 'users.view', 'courses.view', 'roster.view',
      'enrollments.review', 'enrollments.manage', 'enrollments.documents',
      'vouchers.manage', 'announcements.view', 'support.submit', 'reports.submit',
    ],
  },
  {
    id: 'finance',
    name: 'Finance / Billing Officer',
    description: 'Payment collection, statement of accounts, billing management, vouchers, and audit inspection.',
    permissions: [
      'dashboard.view', 'users.view', 'billing.view', 'billing.manage', 'statement.view',
      'vouchers.manage', 'enrollments.documents', 'audit.view', 'support.submit',
    ],
  },
  {
    id: 'content_manager',
    name: 'Content & Community Manager',
    description: 'Course catalog publication, resource library, blog publications, webinars, and forum moderation.',
    permissions: [
      'courses.view', 'catalog.manage', 'webinars.view', 'webinars.manage',
      'blog.view', 'blog.manage', 'email_automation.manage', 'content.view', 'content.manage',
      'forums.participate', 'forums.moderate', 'announcements.view', 'announcements.create',
      'support.submit', 'reports.submit',
    ],
  },
  {
    id: 'support_agent',
    name: 'Support & Helpdesk Agent',
    description: 'Customer inquiries, support ticket resolution, user profiles, and incident reporting.',
    permissions: [
      'dashboard.view', 'users.view', 'courses.view', 'support.submit', 'support.manage',
      'reports.submit', 'reports.manage', 'announcements.view',
    ],
  },
  {
    id: 'learner',
    name: 'Learner / Student',
    description: 'Standard student access to coursework, quizzes, assignments, certificate viewing, and discussions.',
    permissions: [
      'courses.view', 'assignments.submit', 'quizzes.attempt', 'certificates.view',
      'statement.view', 'forums.participate', 'announcements.view', 'calendar.view',
      'recognition.view', 'support.submit', 'reports.submit',
    ],
  },
  {
    id: 'auditor',
    name: 'Auditor / Observer (Read-Only)',
    description: 'Read-only access to audit logs, analytics, course catalog, and reports without edit rights.',
    permissions: [
      'dashboard.view', 'users.view', 'courses.view', 'audit.view',
      'analytics.view', 'reports.manage', 'content.view',
    ],
  },
  {
    id: 'clear',
    name: 'Clear All (Clean Slate)',
    description: 'Removes all permissions for this role so you can configure it from scratch.',
    permissions: [],
  },
]
