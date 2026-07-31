import { authedFetch } from './auth.js'

async function json(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? 'That request could not be completed. Please try again.')
  return data
}

const get = (path) => authedFetch(path).then(json)
const post = (path, body) => authedFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then(json)
const patch = (path, body) => authedFetch(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then(json)
const del = (path) => authedFetch(path, { method: 'DELETE' }).then(async (response) => { if (!response.ok && response.status !== 204) throw new Error((await response.json().catch(() => ({}))).error ?? 'That request could not be completed.'); return true })

export const fetchCourses = () => get('/api/courses')
export const fetchCourse = (id) => get(`/api/courses/${id}`)
export const fetchCourseCategories = (id) => get(`/api/courses/${id}/categories`)
export const fetchCourseCategory = (courseId, categoryId) => get(`/api/courses/${courseId}/categories/${categoryId}`)
export const completeModule = (moduleId) => post(`/api/learning/modules/${moduleId}/complete`)

// Instructor teaching workspace
export const fetchStaffOverview = () => get('/api/staff/overview')
export const fetchGradingQueue = () => get('/api/staff/grading-queue')
export const fetchLearners = (params = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value)).toString()
  return get(`/api/staff/learners${query ? `?${query}` : ''}`)
}
export const fetchGradebook = (courseId) => get(`/api/staff/courses/${courseId}/gradebook`)
export const gradeSubmission = (submissionId, payload) => post(`/api/staff/submissions/${submissionId}/grade`, payload)

export const createCourse = (payload) => post('/api/staff/courses', payload)
export const updateCourse = (id, payload) => patch(`/api/staff/courses/${id}`, payload)
export const uploadCourseBanner = async (id, file) => {
  const body = new FormData()
  body.append('banner', file)
  const response = await authedFetch(`/api/staff/courses/${id}/banner`, { method: 'POST', body })
  return json(response)
}
export const uploadCourseAgreementTemplate = async (id, file) => {
  const body = new FormData()
  body.append('template', file)
  const response = await authedFetch(`/api/staff/courses/${id}/agreement-template`, { method: 'POST', body })
  return json(response)
}
export const deleteCourseAgreementTemplate = (id) => del(`/api/staff/courses/${id}/agreement-template`)
export const fetchCourseAgreementEnrollments = (id) => get(`/api/staff/courses/${id}/agreement-enrollments`)
export const submitCourseForReview = (id) => post(`/api/staff/courses/${id}/submit-review`)
export const createModule = (courseId, payload) => post(`/api/staff/courses/${courseId}/modules`, payload)
export const updateModule = (id, payload) => patch(`/api/staff/modules/${id}`, payload)
export const deleteModule = (id) => del(`/api/staff/modules/${id}`)
export const createLesson = (moduleId, payload) => post(`/api/staff/modules/${moduleId}/lessons`, payload)
export const updateLesson = (id, payload) => patch(`/api/staff/lessons/${id}`, payload)
export const deleteLesson = (id) => del(`/api/staff/lessons/${id}`)
export const createAssignment = (courseId, payload) => post(`/api/staff/courses/${courseId}/assignments`, payload)
export const updateAssignment = (id, payload) => patch(`/api/staff/assignments/${id}`, payload)
export const deleteAssignment = (id) => del(`/api/staff/assignments/${id}`)
export const createQuiz = (courseId, payload) => post(`/api/staff/courses/${courseId}/quizzes`, payload)
export const updateQuiz = (id, payload) => patch(`/api/staff/quizzes/${id}`, payload)
export const deleteQuiz = (id) => del(`/api/staff/quizzes/${id}`)
export const fetchCourseAnalytics = (courseId) => get(`/api/staff/courses/${courseId}/analytics`)

// Announcements & forums
export const fetchAnnouncements = () => get('/api/announcements')
export const createAnnouncement = (courseId, payload) => post(`/api/staff/courses/${courseId}/announcements`, payload)
export const deleteAnnouncement = (id) => del(`/api/staff/announcements/${id}`)
export const fetchThreads = (courseId) => get(`/api/forums/threads${courseId ? `?courseId=${courseId}` : ''}`)
export const fetchThread = (id) => get(`/api/forums/threads/${id}`)
export const createThread = (payload) => post('/api/forums/threads', payload)
export const replyToThread = (id, payload) => post(`/api/forums/threads/${id}/posts`, payload)
export const moderateThread = (id, payload) => patch(`/api/staff/forums/threads/${id}`, payload)
export const deleteThread = (id) => del(`/api/staff/forums/threads/${id}`)
export const reactToThread = (id, type) => post(`/api/forums/threads/${id}/reactions`, { type })
export const updateForumPost = (id, payload) => patch(`/api/forums/posts/${id}`, payload)
export const deleteForumPost = (id) => del(`/api/forums/posts/${id}`)
export const uploadForumImage = async (file) => {
  const body = new FormData()
  body.append('image', file)
  const response = await authedFetch('/api/forums/images', { method: 'POST', body })
  return json(response)
}

export const fetchAssignments = () => get('/api/assignments')
export const fetchAssignment = (id) => get(`/api/assignments/${id}`)
export const submitAssignment = (id, { body, file }) => {
  const form = new FormData()
  if (body) form.append('body', body)
  if (file) form.append('attachment', file)
  return authedFetch(`/api/assignments/${id}/submissions`, { method: 'POST', body: form }).then(json)
}
export async function downloadSubmissionAttachment(submissionId, filename) {
  const response = await authedFetch(`/api/submissions/${submissionId}/attachment`)
  if (!response.ok) return
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename || 'attachment'
  link.click()
  URL.revokeObjectURL(url)
}

// `kind` selects which thing is being commented on — an assignment submission or a quiz attempt.
// Both share one server implementation, so the client only has to swap the path segment.
const commentPath = (kind, id) => (kind === 'quiz' ? `/api/quiz-attempts/${id}/comments` : `/api/submissions/${id}/comments`)
export const fetchSubmissionComments = (id, kind = 'assignment') => get(commentPath(kind, id))
export const postSubmissionComment = (id, body, kind = 'assignment') => post(commentPath(kind, id), { body })

// Staff review feed — assignment submissions and quiz attempts for one course, newest first.
export const fetchCourseSubmissions = (courseId) => get(`/api/staff/courses/${courseId}/submissions`)
export const fetchSubmissionDetail = (id) => get(`/api/staff/submissions/${id}`)

// Attachments are streamed through an authorizing route rather than served from a URL, so the
// preview has to pull the bytes and wrap them in a local blob URL to render inline.
export async function fetchSubmissionAttachmentUrl(submissionId) {
  const response = await authedFetch(`/api/submissions/${submissionId}/attachment`)
  if (!response.ok) throw new Error('That attachment could not be opened.')
  const blob = await response.blob()
  return { url: URL.createObjectURL(blob), type: blob.type }
}
export const fetchQuizAttempt = (id) => get(`/api/staff/quiz-attempts/${id}`)
export const reviewQuizAttempt = (id, payload) => post(`/api/staff/quiz-attempts/${id}/review`, payload)

export const fetchQuizzes = () => get('/api/quizzes')
export const fetchQuiz = (id) => get(`/api/quizzes/${id}`)
export const attemptQuiz = (id, answers) => post(`/api/quizzes/${id}/attempt`, { answers })

export const fetchCalendar = (type) => get(`/api/calendar${type ? `?type=${type}` : ''}`)
export const createCalendarEvent = (payload) => post('/api/staff/calendar-events', payload)
export const updateCalendarEvent = (id, payload) => patch(`/api/staff/calendar-events/${id}`, payload)
export const deleteCalendarEvent = (id) => del(`/api/staff/calendar-events/${id}`)
export const fetchEventAttendance = (eventId) => get(`/api/staff/calendar-events/${eventId}/attendance`)
export const saveEventAttendance = (eventId, records) => post(`/api/staff/calendar-events/${eventId}/attendance`, { records })
export const fetchMyAttendance = (eventId) => get(`/api/calendar-events/${eventId}/attendance/me`)

export const fetchNotifications = () => get('/api/notifications/me')
export const fetchMyBilling = () => get('/api/billing/me')
export const markNotificationRead = (id) => post(`/api/notifications/${id}/read`)
export const markAllNotificationsRead = () => post('/api/notifications/read-all')

export const fetchMyBadges = () => get('/api/badges/me')

// Automatic badge rules — an instructor-defined "give this badge when X happens" condition,
// evaluated server-side the moment a grade/attendance/completion write could make it newly true.
export const fetchStaffBadges = () => get('/api/staff/badges')
export const createBadge = (payload) => post('/api/staff/badges', payload)
export const fetchBadgeRules = (courseId) => get(`/api/staff/badge-rules${courseId ? `?courseId=${courseId}` : ''}`)
export const createBadgeRule = (payload) => post('/api/staff/badge-rules', payload)
export const updateBadgeRule = (id, payload) => patch(`/api/staff/badge-rules/${id}`, payload)
export const deleteBadgeRule = (id) => del(`/api/staff/badge-rules/${id}`)

export const uploadMyAvatar = async (file) => {
  const body = new FormData()
  body.append('avatar', file)
  const response = await authedFetch('/api/users/me/avatar', { method: 'POST', body })
  return json(response)
}

export const fetchBuilderCourses = () => get('/api/staff/builder/courses')
export const fetchBuilderCategories = (courseId) => get(`/api/staff/builder/courses/${courseId}/categories`)
export const createBuilderCategory = (courseId, body) => post(`/api/staff/builder/courses/${courseId}/categories`, body)
export const updateBuilderCategory = (id, body) => patch(`/api/staff/builder/categories/${id}`, body)
export const deleteBuilderCategory = (id) => del(`/api/staff/builder/categories/${id}`)
export const createBuilderHeader = (categoryId, body) => post(`/api/staff/builder/categories/${categoryId}/headers`, body)
export const updateBuilderHeader = (id, body) => patch(`/api/staff/builder/headers/${id}`, body)
export const createBuilderModule = (headerId, body) => post(`/api/staff/builder/headers/${headerId}/modules`, body)
export const updateBuilderModule = (id, body) => patch(`/api/staff/builder/modules/${id}`, body)

export const fetchPresence = () => get('/api/presence')

export const searchAcademy = (q) => get(`/api/search?q=${encodeURIComponent(q)}`)
