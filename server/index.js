import http from 'node:http'
import path from 'node:path'
import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { Server } from 'socket.io'
import { z } from 'zod'
import { config, integrations, isAllowedOrigin, isProduction } from './config.js'
import { catalog } from './catalog.js'
import { Announcement, Assignment, Attendance, CalendarEvent, Course, Enrollment, ForumPost, ForumReaction, ForumThread, LearningProgress, Module, NewsletterSubscriber, Notification, Presence, Quiz, QuizAttempt, Submission, Webinar, WebinarRegistration, User } from './models.js'
import { requireAuth, requireStaff } from './security.js'
import { ensureDefaultEmailTemplates, sendTemplatedEmail } from './email.js'
import { PUBLIC_PREFIX, getFile, isObjectStorage } from './storage.js'
import { dbState, memory } from './state.js'
import { asyncRoute } from './lib/http.js'
import { forumImageUpload, saveForumImageUpload } from './lib/uploads.js'
import { saveAudit } from './lib/audit.js'
import { notifyUsers } from './lib/notify.js'
import { blankToNull } from './lib/zod-helpers.js'
import { learnerVisibleCourseFilter, visibleCourses } from './lib/course-visibility.js'
import { RESERVED_COURSE_SLUGS } from './lib/enrollment-shared.js'
import { runBadgeRules } from './lib/badge-rules.js'
import { router as authRouter } from './routes/auth.js'
import { router as usersRouter } from './routes/users.js'
import { router as enrollmentRouter } from './routes/enrollment.js'
import { router as adminVouchersRouter } from './routes/admin-vouchers.js'
import { router as billingRouter } from './routes/billing.js'
import { router as webhooksRouter } from './routes/webhooks.js'
import { router as adminUsersRouter } from './routes/admin-users.js'
import { router as adminCatalogRouter } from './routes/admin-catalog.js'
import { router as coursesRouter } from './routes/courses.js'
import { router as assignmentsRouter } from './routes/assignments.js'
import { router as quizzesRouter } from './routes/quizzes.js'
import { router as commentsRouter } from './routes/comments.js'
import { router as badgesRouter } from './routes/badges.js'

const app = express()
const server = http.createServer(app)
// Socket.IO shares the HTTP CORS allow-list so the presence socket works from the same origins
// the REST API does — including per-deploy preview URLs.
const io = new Server(server, { cors: { origin: (origin, callback) => callback(null, isAllowedOrigin(origin)), credentials: true } })

app.set('trust proxy', 1)
app.use(helmet({ crossOriginResourcePolicy: false }))
// See isAllowedOrigin in config.js — the same allow-list guards the Socket.IO handshake above.
app.use(cors({ origin: (origin, callback) => callback(null, isAllowedOrigin(origin)), credentials: true }))
app.use(cookieParser())
app.use(express.json({ limit: '1mb', verify: (req, _res, buffer) => { req.rawBody = buffer } }))
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 250, standardHeaders: 'draft-8', legacyHeaders: false }))
// Serves the public/ prefix of the storage layer. When a public bucket hostname is configured the
// browser goes straight to the CDN and never hits this route, but it stays mounted so avatars and
// banners still resolve on local disk in development and before that hostname is set up.
app.get('/uploads/{*filePath}', async (req, res) => {
  const relativePath = Array.isArray(req.params.filePath) ? req.params.filePath.join('/') : req.params.filePath
  try {
    const bytes = await getFile(`${PUBLIC_PREFIX}${relativePath}`)
    const extension = path.extname(relativePath).toLowerCase()
    res.type({ '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }[extension] ?? 'application/octet-stream')
    res.set('Cache-Control', 'public, max-age=604800, immutable')
    res.send(bytes)
  } catch {
    // Missing key, traversal attempt, or provider error — all indistinguishable to a caller.
    res.status(404).end()
  }
})

app.use(authRouter)
app.use(usersRouter)
app.use(enrollmentRouter)
app.use(adminVouchersRouter)
app.use(billingRouter)
app.use(webhooksRouter)
app.use(adminUsersRouter)
app.use(adminCatalogRouter)
app.use(coursesRouter)
app.use(assignmentsRouter)
app.use(quizzesRouter)
app.use(commentsRouter)
app.use(badgesRouter)

const newsletterInput = z.object({ email: z.string().email().max(254) })
// An instructor reviewing an attempt may override the automatic score (after marking an essay,
// say) and/or leave written feedback — both optional, since either alone is a valid review.
const quizReviewInput = z.object({ reviewedScore: z.coerce.number().min(0).nullable().optional(), feedback: z.string().trim().max(2000).optional() })
const calendarEventInput = z.object({
  title: z.string().trim().min(2).max(160),
  description: blankToNull(z.string().trim().max(2000)),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullable().optional(),
  eventType: z.enum(['live_review', 'deadline', 'announcement', 'office_hours']).optional(),
  // Nullable so clearing the field removes the course link rather than being ignored as "absent".
  courseId: blankToNull(z.string().trim().min(1)),
  // Restricted to http(s): this renders as a button learners are told to click, so it must not be
  // able to carry a `javascript:` or `data:` URL into the page.
  meetingUrl: blankToNull(z.string().trim().max(500).refine((value) => /^https?:\/\//i.test(value), 'Enter a full link starting with https://')),
})
const calendarEventUpdateInput = calendarEventInput.partial()
const attendanceInput = z.object({
  records: z.array(z.object({ learnerId: z.string().trim().min(1), status: z.enum(['present', 'absent', 'excused', 'late']) })).min(1).max(500),
})
const announcementInput = z.object({
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().min(2).max(4000),
  pinned: z.boolean().optional(),
})
// Set by POST /api/forums/images (which generates it via the same public-image pipeline as
// avatars/banners) — trusted enough to just shape-check here rather than re-verify storage.
const forumImageUrl = z.string().trim().max(500).refine((value) => value.startsWith('/uploads/forum/') || /^https?:\/\//.test(value), 'Invalid image URL.').nullable().optional()
const forumThreadInput = z.object({
  courseId: z.string().trim().min(1),
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().min(2).max(6000),
  imageUrl: forumImageUrl,
  // "Who can reply", set at creation. Server-enforced below: only staff-authored threads may ever
  // be created locked — a learner crafting `isLocked: true` into the request must not be able to
  // grant themselves moderator-only reply gating on their own thread.
  isLocked: z.boolean().optional(),
})
const forumPostInput = z.object({ body: z.string().trim().min(1).max(6000), imageUrl: forumImageUrl })
const forumModerateInput = z.object({ isPinned: z.boolean().optional(), isLocked: z.boolean().optional() })
const forumReactionInput = z.object({ type: z.enum(['like', 'dislike']) })
const notificationBroadcastInput = z.object({
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().max(2000).optional(),
  link: z.string().trim().max(300).optional(),
  audience: z.enum(['all_learners', 'all_staff', 'everyone']).optional(),
  recipientIds: z.array(z.string().trim().min(1)).optional(),
})

const webinarRegisterInput = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(254) })

app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: dbState.ready ? 'connected' : 'demo-memory', integrations }))
app.get('/api/catalog', (_req, res) => res.json(catalog))

// Live pathway stats for the existing "Three pathways" landing section — seed data maps one
// Course per pathway via slug `${pathwayId}-review` (see seed-content.js), so that's the join key.
// Folds enrollment counts + seasonal availability into the pathway cards already on the page,
// rather than a separate catalog section.
app.get('/api/public/pathway-stats', asyncRoute(async (_req, res) => {
  if (!dbState.ready) return res.json({})
  const now = new Date()
  const courses = await Course.find({ slug: { $in: RESERVED_COURSE_SLUGS } })
    .select('slug isPublished archivedAt availableFrom availableUntil showEnrollmentCount').lean()
  const enrollCounts = await LearningProgress.aggregate([
    { $match: { courseId: { $in: courses.map((course) => course._id) } } },
    { $group: { _id: '$courseId', count: { $sum: 1 } } },
  ])
  const enrollMap = new Map(enrollCounts.map((row) => [String(row._id), row.count]))
  const stats = {}
  for (const course of courses) {
    const pathwayId = course.slug.replace(/-review$/, '')
    const isOpen = course.isPublished && !course.archivedAt
    stats[pathwayId] = {
      enrolledCount: course.showEnrollmentCount !== false ? (enrollMap.get(String(course._id)) ?? 0) : null,
      availableFrom: course.availableFrom ?? null,
      availableUntil: course.availableUntil ?? null,
      opensLater: Boolean(isOpen && course.availableFrom && new Date(course.availableFrom) > now),
      closed: !isOpen || Boolean(course.availableUntil && new Date(course.availableUntil) < now),
    }
  }
  res.json(stats)
}))

// Special courses / webinars — visible only while open: published, before the registration
// deadline (or start time if none set), and under capacity. They disappear from the public list
// automatically once any of those conditions trips, no admin action required.
function visibleWebinarFilter() {
  return { isPublished: true, $expr: { $gte: [{ $ifNull: ['$registrationDeadline', '$startsAt'] }, new Date()] } }
}

app.get('/api/public/webinars', asyncRoute(async (_req, res) => {
  if (!dbState.ready) return res.json([])
  const webinars = await Webinar.find(visibleWebinarFilter()).sort({ startsAt: 1 }).lean()
  const counts = await WebinarRegistration.aggregate([
    { $match: { webinarId: { $in: webinars.map((webinar) => webinar._id) } } },
    { $group: { _id: '$webinarId', count: { $sum: 1 } } },
  ])
  const countById = new Map(counts.map((row) => [String(row._id), row.count]))
  res.json(webinars
    .map((webinar) => ({
      id: webinar._id.toString(), title: webinar.title, description: webinar.description ?? '',
      startsAt: webinar.startsAt, registrationDeadline: webinar.registrationDeadline ?? null,
      capacity: webinar.capacity ?? null, registeredCount: countById.get(String(webinar._id)) ?? 0,
    }))
    .filter((webinar) => webinar.capacity == null || webinar.registeredCount < webinar.capacity))
}))

app.post('/api/public/webinars/:id/register', asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Registration requires MongoDB.' })
  const webinar = await Webinar.findOne({ _id: req.params.id, ...visibleWebinarFilter() })
  if (!webinar) return res.status(404).json({ error: 'This webinar is no longer accepting registrations.' })
  if (webinar.capacity != null) {
    const registeredCount = await WebinarRegistration.countDocuments({ webinarId: webinar._id })
    if (registeredCount >= webinar.capacity) return res.status(409).json({ error: 'This webinar is full.' })
  }
  const values = webinarRegisterInput.parse(req.body)
  try {
    await WebinarRegistration.create({ webinarId: webinar._id, name: values.name, email: values.email.toLowerCase() })
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'You are already registered for this webinar.' })
    throw error
  }
  sendTemplatedEmail('webinar_registration', values.email, { name: values.name, webinarTitle: webinar.title, webinarDate: new Date(webinar.startsAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) })
    .catch((emailError) => console.error('webinar_registration email failed:', emailError.message))
  await saveAudit('webinar.registered', 'Webinar', webinar.id, { email: values.email })
  res.status(201).json({ registered: true })
}))

// Auth (login/refresh/logout/impersonation/activation/password reset/Google OAuth) and profile
// routes (/api/users/*) now live in routes/auth.js and routes/users.js — see app.use() below.

app.post('/api/newsletter', asyncRoute(async (req, res) => {
  const { email } = newsletterInput.parse(req.body)
  const normalized = email.toLowerCase()

  let shouldSendConfirmation = true
  let createdSubscriber = false
  let reactivatedSubscriber = false

  if (dbState.ready) {
    const existingSubscriber = await NewsletterSubscriber.findOne({ email: normalized })
    if (existingSubscriber && existingSubscriber.status !== 'unsubscribed') shouldSendConfirmation = false
    else if (existingSubscriber) {
      reactivatedSubscriber = true
      await NewsletterSubscriber.updateOne({ _id: existingSubscriber._id }, { status: 'pending', consentedAt: new Date() })
    }
    else {
      try {
        await NewsletterSubscriber.create({ email: normalized, status: 'pending', consentedAt: new Date() })
        createdSubscriber = true
      } catch (error) {
        if (error?.code === 11000) shouldSendConfirmation = false
        else throw error
      }
    }
  } else {
    const existingSubscriber = memory.newsletter.get(normalized)
    if (existingSubscriber && existingSubscriber.status !== 'unsubscribed') shouldSendConfirmation = false
    else {
      createdSubscriber = !existingSubscriber
      reactivatedSubscriber = Boolean(existingSubscriber)
      memory.newsletter.set(normalized, { email: normalized, status: 'pending', consentedAt: new Date() })
    }
  }

  if (shouldSendConfirmation) {
    try {
      await sendTemplatedEmail('newsletter_confirmation', normalized, { email: normalized })
      await saveAudit('newsletter.confirmation_requested', 'NewsletterSubscriber', normalized)
    } catch (error) {
      if (dbState.ready && createdSubscriber) await NewsletterSubscriber.deleteOne({ email: normalized })
      else if (dbState.ready && reactivatedSubscriber) await NewsletterSubscriber.updateOne({ email: normalized }, { status: 'unsubscribed' })
      else if (createdSubscriber) memory.newsletter.delete(normalized)
      else if (reactivatedSubscriber) memory.newsletter.set(normalized, { email: normalized, status: 'unsubscribed' })
      throw error
    }
  }

  res.status(shouldSendConfirmation ? 201 : 200).json({
    status: shouldSendConfirmation ? 'pending_confirmation' : 'already_registered',
    message: 'You’re on the list. Please check your inbox.',
  })
}))

// Instructor teaching workspace — all instructors share every course, so "their courses" and
// "their students" span the whole catalog. These aggregation routes power the instructor
// dashboard, gradebook, and roster.
const ungradedFilter = { submittedAt: { $ne: null }, $or: [{ grade: { $exists: false } }, { grade: null }] }

// A submission whose assignment or learner has since been deleted can't be graded — there's no
// rubric to grade against and nobody to notify. Left in, it surfaces as a ghost row of fallback
// labels ("Assignment", "Learner · Course") and inflates the pending-grading count with work no
// one can ever clear. Both the queue and the badge use this definition so they agree.
const actionableUngraded = [
  { $match: ungradedFilter },
  { $lookup: { from: 'assignments', localField: 'assignmentId', foreignField: '_id', as: 'assignmentDoc' } },
  { $lookup: { from: 'users', localField: 'learnerId', foreignField: '_id', as: 'learnerDoc' } },
  { $match: { 'assignmentDoc.0': { $exists: true }, 'learnerDoc.0': { $exists: true } } },
]

// Quiz attempts containing a question the auto-grader can't judge (essay) also wait on a human, so
// the dashboard count matches what the Submissions page actually lists as "Needs grading".
async function pendingGradingCount() {
  const [submissions, attempts] = await Promise.all([
    Submission.aggregate([...actionableUngraded, { $count: 'count' }]),
    QuizAttempt.countDocuments({ reviewedAt: null, 'results.correct': null }),
  ])
  return (submissions[0]?.count ?? 0) + attempts
}

app.get('/api/staff/overview', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'The teaching dashboard requires MongoDB.' })
  const [courses, learnerCount, pendingGrading, upcoming, pendingApprovals] = await Promise.all([
    Course.find().select('_id title isPublished').lean(),
    User.countDocuments({ role: 'learner', status: 'active' }),
    pendingGradingCount(),
    Assignment.find({ dueAt: { $gte: new Date() } }).sort({ dueAt: 1 }).limit(6).lean(),
    Enrollment.countDocuments({ status: 'paid_approval_pending' }),
  ])
  const titleById = new Map(courses.map((course) => [String(course._id), course.title]))
  res.json({
    courseCount: courses.length,
    publishedCount: courses.filter((course) => course.isPublished).length,
    learnerCount,
    pendingGrading,
    pendingApprovals,
    upcomingDeadlines: upcoming.map((assignment) => ({ id: assignment._id.toString(), title: assignment.title, dueAt: assignment.dueAt, courseTitle: titleById.get(String(assignment.courseId)) ?? 'Course' })),
  })
}))

app.get('/api/staff/grading-queue', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Grading requires MongoDB.' })
  const courses = await Course.find().select('_id title').lean()
  const titleById = new Map(courses.map((course) => [String(course._id), course.title]))
  const submissions = await Submission.find(ungradedFilter)
    .populate('learnerId', 'name email')
    .populate('assignmentId', 'title courseId maxPoints')
    .sort({ submittedAt: 1 }).limit(200).lean()
  res.json(submissions
    // populate() yields null for a deleted reference; those rows are ungradeable, so drop them
    // rather than rendering placeholder text where a learner's name should be.
    .filter((submission) => submission.assignmentId && submission.learnerId)
    .map((submission) => ({
      id: submission._id.toString(),
      learner: { name: submission.learnerId.name, email: submission.learnerId.email },
      assignmentTitle: submission.assignmentId.title,
      maxPoints: submission.assignmentId.maxPoints ?? 100,
      courseTitle: titleById.get(String(submission.assignmentId.courseId)) ?? 'Course',
      submittedAt: submission.submittedAt,
      body: submission.body ?? '',
      // The storage key stays server-side; the attachment is fetched through the route that
      // authorizes the caller first.
      hasAttachment: Boolean(submission.attachmentKey),
      attachmentName: submission.attachmentName ?? null,
    })))
}))

app.get('/api/staff/learners', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'The roster requires MongoDB.' })
  // Status and course are filtered in Mongo rather than in the browser, so the roster stays honest
  // once there are more learners than one page can hold.
  const filter = { role: 'learner' }
  if (req.query.status) filter.status = String(req.query.status)
  if (req.query.courseId) {
    const enrolled = await LearningProgress.find({ courseId: req.query.courseId }).select('learnerId').lean()
    filter._id = { $in: enrolled.map((row) => row.learnerId) }
  }
  const learners = await User.find(filter).select('name email status createdAt lastSeenAt avatarUrl').sort({ name: 1 }).lean()
  const grouped = await LearningProgress.aggregate([
    { $group: { _id: '$learnerId', courses: { $sum: 1 }, modules: { $sum: { $size: { $ifNull: ['$completedModuleIds', []] } } } } },
  ])
  const statsById = new Map(grouped.map((row) => [String(row._id), row]))
  res.json(learners.map((learner) => ({
    id: learner._id.toString(), name: learner.name, email: learner.email, status: learner.status,
    avatarUrl: learner.avatarUrl ?? null, createdAt: learner.createdAt, lastSeenAt: learner.lastSeenAt ?? null,
    enrolledCourses: statsById.get(String(learner._id))?.courses ?? 0,
    completedModules: statsById.get(String(learner._id))?.modules ?? 0,
  })))
}))

app.get('/api/staff/courses/:id/gradebook', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'The gradebook requires MongoDB.' })
  const course = await Course.findById(req.params.id).select('title slug').lean()
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const assignments = await Assignment.find({ courseId: course._id }).select('title maxPoints dueAt').sort({ createdAt: 1 }).lean()
  const progresses = await LearningProgress.find({ courseId: course._id }).select('learnerId').lean()
  const learnerIds = progresses.map((progress) => progress.learnerId)
  const learners = await User.find({ _id: { $in: learnerIds } }).select('name email').sort({ name: 1 }).lean()
  const submissions = await Submission.find({ assignmentId: { $in: assignments.map((assignment) => assignment._id) }, learnerId: { $in: learnerIds } })
    .select('assignmentId learnerId grade feedback body attachmentKey attachmentName submittedAt').lean()
  res.json({
    course: { id: course._id.toString(), title: course.title, slug: course.slug },
    assignments: assignments.map((assignment) => ({ id: assignment._id.toString(), title: assignment.title, maxPoints: assignment.maxPoints ?? 100, dueAt: assignment.dueAt ?? null })),
    learners: learners.map((learner) => ({ id: learner._id.toString(), name: learner.name, email: learner.email })),
    submissions: submissions.map((submission) => ({
      id: submission._id.toString(), assignmentId: String(submission.assignmentId), learnerId: String(submission.learnerId),
      grade: submission.grade ?? null, feedback: submission.feedback ?? '', body: submission.body ?? '',
      attachmentKey: submission.attachmentKey ?? null, attachmentName: submission.attachmentName ?? null,
      submittedAt: submission.submittedAt ?? null,
    })),
  })
}))

// One feed of everything learners have handed in for a course — assignment submissions and quiz
// attempts together, newest first. The two are stored in different collections but an instructor
// reviewing work doesn't care which; they care what still needs marking.
app.get('/api/staff/courses/:id/submissions', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Submissions require MongoDB.' })
  const course = await Course.findById(req.params.id).select('title').lean()
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const [assignments, quizzes] = await Promise.all([
    Assignment.find({ courseId: course._id }).select('title maxPoints dueAt').lean(),
    Quiz.find({ courseId: course._id }).select('title').lean(),
  ])
  const assignmentById = new Map(assignments.map((row) => [String(row._id), row]))
  const quizById = new Map(quizzes.map((row) => [String(row._id), row]))
  const [submissions, attempts] = await Promise.all([
    Submission.find({ assignmentId: { $in: assignments.map((row) => row._id) } }).populate('learnerId', 'name email avatarUrl').sort({ submittedAt: -1 }).lean(),
    QuizAttempt.find({ courseId: course._id }).populate('learnerId', 'name email avatarUrl').sort({ submittedAt: -1 }).lean(),
  ])
  const learnerOf = (row) => (row.learnerId ? { id: String(row.learnerId._id), name: row.learnerId.name, email: row.learnerId.email, avatarUrl: row.learnerId.avatarUrl ?? null } : null)

  const rows = [
    ...submissions.map((row) => {
      const assignment = assignmentById.get(String(row.assignmentId))
      const maxPoints = assignment?.maxPoints ?? 100
      return {
        id: String(row._id), kind: 'assignment', title: assignment?.title ?? 'Assignment',
        learner: learnerOf(row), submittedAt: row.submittedAt ?? row.createdAt,
        maxPoints, score: row.grade ?? null,
        percent: row.grade == null ? null : Math.round((row.grade / (maxPoints || 100)) * 100),
        status: row.grade == null ? 'needs_grading' : 'graded',
        hasAttachment: Boolean(row.attachmentKey), hasResponse: Boolean(row.body),
      }
    }),
    ...attempts.map((row) => {
      // An essay question can't be auto-marked, so an attempt containing one waits for a human
      // even though the rest of it already has a score.
      const needsReview = Array.isArray(row.results) && row.results.some((result) => result?.correct === null)
      const score = row.reviewedScore ?? row.score
      return {
        id: String(row._id), kind: 'quiz', title: quizById.get(String(row.quizId))?.title ?? 'Quiz',
        learner: learnerOf(row), submittedAt: row.submittedAt ?? row.createdAt,
        maxPoints: row.total, score,
        percent: row.reviewedScore != null && row.total ? Math.round((row.reviewedScore / row.total) * 100) : row.percent,
        status: needsReview && row.reviewedAt == null ? 'needs_grading' : 'graded',
        autoGraded: true, reviewed: Boolean(row.reviewedAt),
      }
    }),
  ].sort((first, second) => new Date(second.submittedAt ?? 0) - new Date(first.submittedAt ?? 0))

  res.json({ course: { id: String(course._id), title: course.title }, rows })
}))

// Full detail for one quiz attempt: every question, what the learner answered, and whether it was
// right. This is the "view what the student sent" half of reviewing a quiz.
app.get('/api/staff/quiz-attempts/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Quiz attempts require MongoDB.' })
  const attempt = await QuizAttempt.findById(req.params.id).populate('learnerId', 'name email avatarUrl').populate('quizId', 'title').lean()
  if (!attempt) return res.status(404).json({ error: 'Quiz attempt not found.' })
  res.json({
    id: String(attempt._id), title: attempt.quizId?.title ?? 'Quiz',
    learner: attempt.learnerId ? { id: String(attempt.learnerId._id), name: attempt.learnerId.name, email: attempt.learnerId.email } : null,
    submittedAt: attempt.submittedAt ?? attempt.createdAt,
    score: attempt.score, total: attempt.total, percent: attempt.percent,
    reviewedScore: attempt.reviewedScore ?? null, feedback: attempt.feedback ?? '', reviewedAt: attempt.reviewedAt ?? null,
    answers: attempt.answers ?? [], results: attempt.results ?? [],
  })
}))

app.post('/api/staff/quiz-attempts/:id/review', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Quiz attempts require MongoDB.' })
  const attempt = await QuizAttempt.findById(req.params.id)
  if (!attempt) return res.status(404).json({ error: 'Quiz attempt not found.' })
  const values = quizReviewInput.parse(req.body)
  if (values.reviewedScore != null && values.reviewedScore > attempt.total) return res.status(422).json({ error: `Score cannot exceed ${attempt.total}.` })
  Object.assign(attempt, { ...values, reviewedBy: req.auth.sub, reviewedAt: new Date() })
  await attempt.save()
  await saveAudit('quiz_attempt.reviewed', 'QuizAttempt', attempt.id, {}, req.auth.sub)
  const quiz = await Quiz.findById(attempt.quizId).select('title courseId').lean()
  await notifyUsers([attempt.learnerId], {
    title: `Reviewed: ${quiz?.title ?? 'Quiz'}`,
    body: `You scored ${values.reviewedScore ?? attempt.score}/${attempt.total}${values.feedback ? ` — ${values.feedback}` : ''}`,
    link: '/catalog',
  })
  if (quiz?.courseId) await runBadgeRules(String(quiz.courseId), [String(attempt.learnerId)], ['score_threshold'])
  res.json({ ok: true })
}))

app.get('/api/staff/courses/:id/analytics', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Course analytics require MongoDB.' })
  const course = await Course.findById(req.params.id).select('title slug').lean()
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const [modules, assignments] = await Promise.all([
    Module.find({ courseId: course._id, isPublished: true }).select('title position').sort({ position: 1 }).lean(),
    Assignment.find({ courseId: course._id }).select('title maxPoints dueAt').lean(),
  ])
  const moduleCount = modules.length
  const progresses = await LearningProgress.find({ courseId: course._id }).select('learnerId completedModuleIds completedAt').lean()
  const learnerIds = progresses.map((progress) => progress.learnerId)
  const learners = await User.find({ _id: { $in: learnerIds } }).select('name email').lean()
  const learnerById = new Map(learners.map((learner) => [String(learner._id), learner]))
  const assignmentMax = new Map(assignments.map((assignment) => [String(assignment._id), assignment.maxPoints ?? 100]))
  const submissions = await Submission.find({ assignmentId: { $in: assignments.map((assignment) => assignment._id) }, learnerId: { $in: learnerIds } })
    .select('assignmentId learnerId grade submittedAt').lean()

  const moduleCompletion = new Map(modules.map((module) => [String(module._id), 0]))
  const gradesByLearner = new Map()
  const submittedByLearner = new Map()
  for (const submission of submissions) {
    const learnerKey = String(submission.learnerId)
    submittedByLearner.set(learnerKey, (submittedByLearner.get(learnerKey) ?? 0) + 1)
    if (submission.grade != null) {
      const percent = Math.round((submission.grade / (assignmentMax.get(String(submission.assignmentId)) || 100)) * 100)
      if (!gradesByLearner.has(learnerKey)) gradesByLearner.set(learnerKey, [])
      gradesByLearner.get(learnerKey).push(percent)
    }
  }

  const roster = progresses.map((progress) => {
    const learnerKey = String(progress.learnerId)
    const completed = (progress.completedModuleIds ?? []).filter((moduleId) => moduleCompletion.has(String(moduleId)))
    for (const moduleId of completed) moduleCompletion.set(String(moduleId), moduleCompletion.get(String(moduleId)) + 1)
    const progressPercent = moduleCount ? Math.round((completed.length / moduleCount) * 100) : 0
    const grades = gradesByLearner.get(learnerKey) ?? []
    const avgGrade = grades.length ? Math.round(grades.reduce((sum, value) => sum + value, 0) / grades.length) : null
    const missing = assignments.length - (submittedByLearner.get(learnerKey) ?? 0)
    const reasons = []
    if (progressPercent < 40) reasons.push('Low progress')
    if (avgGrade != null && avgGrade < 60) reasons.push('Low grades')
    if (missing > 0 && assignments.length > 0) reasons.push(`${missing} not submitted`)
    const learner = learnerById.get(learnerKey)
    return { id: learnerKey, name: learner?.name ?? 'Learner', email: learner?.email ?? '', progressPercent, avgGrade, missing, completed: Boolean(progress.completedAt), reasons }
  }).sort((first, second) => first.progressPercent - second.progressPercent)

  const learnerCount = roster.length
  const completionRate = learnerCount ? Math.round(roster.reduce((sum, row) => sum + row.progressPercent, 0) / learnerCount) : 0
  const gradedPercents = [...gradesByLearner.values()].flat()
  const avgGrade = gradedPercents.length ? Math.round(gradedPercents.reduce((sum, value) => sum + value, 0) / gradedPercents.length) : null
  const submissionRate = learnerCount && assignments.length ? Math.round((submissions.length / (assignments.length * learnerCount)) * 100) : 0

  res.json({
    course: { id: course._id.toString(), title: course.title, slug: course.slug },
    learnerCount,
    moduleCount,
    assignmentCount: assignments.length,
    completedLearners: roster.filter((row) => row.completed).length,
    completionRate,
    avgGrade,
    submissionRate,
    moduleBreakdown: modules.map((module) => ({ id: module._id.toString(), title: module.title, completedCount: moduleCompletion.get(String(module._id)) ?? 0, percent: learnerCount ? Math.round(((moduleCompletion.get(String(module._id)) ?? 0) / learnerCount) * 100) : 0 })),
    atRisk: roster.filter((row) => row.reasons.length > 0),
  })
}))

// Class communication — course announcements (one-way) and discussion forums (two-way).
app.get('/api/announcements', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Announcements require MongoDB.' })
  const courses = await visibleCourses(req.auth.role, req.auth.sub)
  const titleById = new Map(courses.map((course) => [String(course._id), course.title]))
  const announcements = await Announcement.find({ courseId: { $in: courses.map((course) => course._id) } })
    .populate('authorId', 'name role').sort({ pinned: -1, createdAt: -1 }).limit(100).lean()
  res.json(announcements.map((announcement) => ({
    id: announcement._id.toString(), courseId: String(announcement.courseId),
    courseTitle: titleById.get(String(announcement.courseId)) ?? 'Course',
    title: announcement.title, body: announcement.body, pinned: announcement.pinned,
    authorId: announcement.authorId?._id ? String(announcement.authorId._id) : null,
    authorName: announcement.authorId?.name ?? 'Staff', createdAt: announcement.createdAt,
  })))
}))

app.post('/api/staff/courses/:id/announcements', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Announcements require MongoDB.' })
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const values = announcementInput.parse(req.body)
  const announcement = await Announcement.create({ ...values, courseId: course._id, authorId: req.auth.sub })
  // Notify every learner granted access to this course (LearningProgress is the enrollment record,
  // created automatically when their pathway enrollment is approved — see provisionLearnerAccount).
  const enrolled = await LearningProgress.find({ courseId: course._id }).select('learnerId').lean()
  if (enrolled.length) await Notification.insertMany(enrolled.map((row) => ({ recipientId: row.learnerId, title: `${course.title}: ${values.title}`, body: values.body.slice(0, 300), link: '/announcements' })))
  await saveAudit('announcement.created', 'Announcement', announcement.id, { courseId: course.id }, req.auth.sub)
  res.status(201).json(announcement)
}))

app.delete('/api/staff/announcements/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Announcements require MongoDB.' })
  const announcement = await Announcement.findById(req.params.id)
  if (!announcement) return res.status(404).json({ error: 'Announcement not found.' })
  // Admins can moderate any announcement; instructors may only remove their own.
  if (req.auth.role !== 'admin' && String(announcement.authorId) !== req.auth.sub) {
    return res.status(403).json({ error: 'You can only delete your own announcements.' })
  }
  await announcement.deleteOne()
  await saveAudit('announcement.deleted', 'Announcement', announcement.id, {}, req.auth.sub)
  res.status(204).end()
}))

app.post('/api/forums/images', requireAuth, forumImageUpload.single('image'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Attach a PNG, JPEG, or WEBP image.' })
  const imageUrl = await saveForumImageUpload(req.file)
  res.status(201).json({ imageUrl })
}))

app.get('/api/forums/threads', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Forums require MongoDB.' })
  const courses = await visibleCourses(req.auth.role, req.auth.sub)
  const titleById = new Map(courses.map((course) => [String(course._id), course.title]))
  const filter = { courseId: { $in: courses.map((course) => course._id) } }
  if (req.query.courseId) filter.courseId = req.query.courseId
  const threads = await ForumThread.find(filter).populate('authorId', 'name role avatarUrl').sort({ isPinned: -1, lastPostAt: -1 }).limit(100).lean()
  const threadIds = threads.map((thread) => thread._id)
  const counts = await ForumPost.aggregate([{ $match: { threadId: { $in: threadIds } } }, { $group: { _id: '$threadId', count: { $sum: 1 } } }])
  const countById = new Map(counts.map((row) => [String(row._id), row.count]))
  // Recent repliers, newest first, for the avatar stack — capped well below the page limit since
  // this is only ever collapsed down to a few faces per thread, never listed in full.
  const recentPosts = await ForumPost.find({ threadId: { $in: threadIds } }).select('threadId authorId')
    .populate('authorId', 'name avatarUrl').sort({ createdAt: -1 }).limit(1000).lean()
  const participantsById = new Map()
  for (const post of recentPosts) {
    const list = participantsById.get(String(post.threadId)) ?? []
    if (list.length < 3 && post.authorId && !list.some((person) => person.id === String(post.authorId._id))) {
      list.push({ id: String(post.authorId._id), name: post.authorId.name, avatarUrl: post.authorId.avatarUrl ?? null })
    }
    participantsById.set(String(post.threadId), list)
  }
  res.json(threads.map((thread) => {
    const authorId = thread.authorId?._id ? String(thread.authorId._id) : null
    const repliers = (participantsById.get(String(thread._id)) ?? []).filter((person) => person.id !== authorId)
    return {
      id: thread._id.toString(), courseId: String(thread.courseId),
      courseTitle: titleById.get(String(thread.courseId)) ?? 'Course',
      title: thread.title, body: thread.body, imageUrl: thread.imageUrl ?? null, isPinned: thread.isPinned, isLocked: thread.isLocked,
      authorName: thread.authorId?.name ?? 'Member', authorRole: thread.authorId?.role ?? 'learner', authorAvatarUrl: thread.authorId?.avatarUrl ?? null,
      participants: [{ name: thread.authorId?.name ?? 'Member', avatarUrl: thread.authorId?.avatarUrl ?? null }, ...repliers].slice(0, 4),
      replyCount: countById.get(String(thread._id)) ?? 0, viewCount: thread.viewCount ?? 0,
      lastPostAt: thread.lastPostAt, createdAt: thread.createdAt,
    }
  }))
}))

app.post('/api/forums/threads', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Forums require MongoDB.' })
  const values = forumThreadInput.parse(req.body)
  const course = await Course.findById(values.courseId)
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (!course || (!course.isPublished && !isStaff)) return res.status(404).json({ error: 'Course not found.' })
  if (!isStaff) values.isLocked = false
  const thread = await ForumThread.create({ ...values, authorId: req.auth.sub })
  await saveAudit('forum_thread.created', 'ForumThread', thread.id, { courseId: course.id }, req.auth.sub)
  res.status(201).json(thread)
}))

app.get('/api/forums/threads/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Forums require MongoDB.' })
  const thread = await ForumThread.findById(req.params.id).populate('authorId', 'name role avatarUrl')
  if (!thread) return res.status(404).json({ error: 'Thread not found.' })
  const course = await Course.findById(thread.courseId).select('title isPublished').lean()
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (!course || (!course.isPublished && !isStaff)) return res.status(404).json({ error: 'Thread not found.' })
  thread.viewCount = (thread.viewCount ?? 0) + 1
  await thread.save()
  const [posts, reactionCounts, myReaction] = await Promise.all([
    ForumPost.find({ threadId: thread._id }).populate('authorId', 'name role avatarUrl').sort({ createdAt: 1 }).lean(),
    ForumReaction.aggregate([{ $match: { threadId: thread._id } }, { $group: { _id: '$type', count: { $sum: 1 } } }]),
    ForumReaction.findOne({ threadId: thread._id, userId: req.auth.sub }).select('type').lean(),
  ])
  const likeCount = reactionCounts.find((row) => row._id === 'like')?.count ?? 0
  const dislikeCount = reactionCounts.find((row) => row._id === 'dislike')?.count ?? 0
  res.json({
    id: thread._id.toString(), courseId: String(thread.courseId), courseTitle: course.title,
    title: thread.title, body: thread.body, imageUrl: thread.imageUrl ?? null, isPinned: thread.isPinned, isLocked: thread.isLocked,
    authorName: thread.authorId?.name ?? 'Member', authorRole: thread.authorId?.role ?? 'learner', authorAvatarUrl: thread.authorId?.avatarUrl ?? null,
    viewCount: thread.viewCount, likeCount, dislikeCount, myReaction: myReaction?.type ?? null, createdAt: thread.createdAt,
    posts: posts.map((post) => ({ id: post._id.toString(), body: post.body, imageUrl: post.imageUrl ?? null, authorId: String(post.authorId?._id ?? post.authorId), authorName: post.authorId?.name ?? 'Member', authorRole: post.authorId?.role ?? 'learner', authorAvatarUrl: post.authorId?.avatarUrl ?? null, createdAt: post.createdAt, editedAt: post.editedAt ?? null })),
  })
}))

app.post('/api/forums/threads/:id/reactions', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Forums require MongoDB.' })
  const thread = await ForumThread.findById(req.params.id).select('_id')
  if (!thread) return res.status(404).json({ error: 'Thread not found.' })
  const { type } = forumReactionInput.parse(req.body)
  const existing = await ForumReaction.findOne({ threadId: thread._id, userId: req.auth.sub })
  // Clicking the already-active reaction clears it; clicking the other one switches it — never both.
  if (existing && existing.type === type) await existing.deleteOne()
  else if (existing) { existing.type = type; await existing.save() }
  else await ForumReaction.create({ threadId: thread._id, userId: req.auth.sub, type })
  const [reactionCounts, myReaction] = await Promise.all([
    ForumReaction.aggregate([{ $match: { threadId: thread._id } }, { $group: { _id: '$type', count: { $sum: 1 } } }]),
    ForumReaction.findOne({ threadId: thread._id, userId: req.auth.sub }).select('type').lean(),
  ])
  res.json({
    likeCount: reactionCounts.find((row) => row._id === 'like')?.count ?? 0,
    dislikeCount: reactionCounts.find((row) => row._id === 'dislike')?.count ?? 0,
    myReaction: myReaction?.type ?? null,
  })
}))

app.post('/api/forums/threads/:id/posts', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Forums require MongoDB.' })
  const thread = await ForumThread.findById(req.params.id)
  if (!thread) return res.status(404).json({ error: 'Thread not found.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (thread.isLocked && !isStaff) return res.status(403).json({ error: 'This thread is locked.' })
  const values = forumPostInput.parse(req.body)
  const post = await ForumPost.create({ threadId: thread._id, authorId: req.auth.sub, body: values.body, imageUrl: values.imageUrl })
  thread.lastPostAt = new Date()
  await thread.save()
  res.status(201).json(post)
}))

app.patch('/api/staff/forums/threads/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Forums require MongoDB.' })
  const thread = await ForumThread.findByIdAndUpdate(req.params.id, forumModerateInput.parse(req.body), { new: true })
  if (!thread) return res.status(404).json({ error: 'Thread not found.' })
  await saveAudit('forum_thread.moderated', 'ForumThread', thread.id, { isPinned: thread.isPinned, isLocked: thread.isLocked }, req.auth.sub)
  res.json(thread)
}))

app.delete('/api/staff/forums/threads/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Forums require MongoDB.' })
  const thread = await ForumThread.findByIdAndDelete(req.params.id)
  if (!thread) return res.status(404).json({ error: 'Thread not found.' })
  await Promise.all([ForumPost.deleteMany({ threadId: thread._id }), ForumReaction.deleteMany({ threadId: thread._id })])
  await saveAudit('forum_thread.deleted', 'ForumThread', thread.id, {}, req.auth.sub)
  res.status(204).end()
}))

app.patch('/api/forums/posts/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Forums require MongoDB.' })
  const post = await ForumPost.findById(req.params.id)
  if (!post) return res.status(404).json({ error: 'Reply not found.' })
  // Editing is author-only — staff moderate by removing a reply, never by rewriting someone else's words.
  if (String(post.authorId) !== req.auth.sub) return res.status(403).json({ error: 'You can only edit your own reply.' })
  const values = forumPostInput.parse(req.body)
  post.body = values.body
  if (values.imageUrl !== undefined) post.imageUrl = values.imageUrl
  post.editedAt = new Date()
  await post.save()
  res.json({ id: post.id, body: post.body, imageUrl: post.imageUrl ?? null, editedAt: post.editedAt })
}))

app.delete('/api/forums/posts/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Forums require MongoDB.' })
  const post = await ForumPost.findById(req.params.id)
  if (!post) return res.status(404).json({ error: 'Reply not found.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (!isStaff && String(post.authorId) !== req.auth.sub) return res.status(403).json({ error: 'You can only delete your own reply.' })
  await post.deleteOne()
  await saveAudit('forum_post.deleted', 'ForumPost', post.id, { threadId: String(post.threadId) }, req.auth.sub)
  res.status(204).end()
}))

app.get('/api/calendar', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Calendar requires MongoDB.' })
  const filter = {}
  if (req.query.type) filter.eventType = req.query.type
  const events = await CalendarEvent.find(filter).sort({ startsAt: 1 }).lean()
  const courses = await Course.find({ _id: { $in: events.map((event) => event.courseId).filter(Boolean) } }).select('title').lean()
  const titleById = new Map(courses.map((course) => [String(course._id), course.title]))
  res.json(events.map((event) => ({ ...event, courseTitle: event.courseId ? (titleById.get(String(event.courseId)) ?? null) : null })))
}))

app.post('/api/staff/calendar-events', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Calendar requires MongoDB.' })
  const event = await CalendarEvent.create(calendarEventInput.parse(req.body))
  await saveAudit('calendar_event.created', 'CalendarEvent', event.id, {}, req.auth.sub)
  res.status(201).json(event)
}))

// A recurring session's details drift — the Zoom link is regenerated, the topic changes, it moves
// an hour. Without these an instructor could only ever add events, never correct one.
app.patch('/api/staff/calendar-events/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Calendar requires MongoDB.' })
  const updates = calendarEventUpdateInput.parse(req.body)
  const event = await CalendarEvent.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true })
  if (!event) return res.status(404).json({ error: 'Event not found.' })
  await saveAudit('calendar_event.updated', 'CalendarEvent', event.id, { fields: Object.keys(updates) }, req.auth.sub)
  res.json(event)
}))

app.delete('/api/staff/calendar-events/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Calendar requires MongoDB.' })
  const event = await CalendarEvent.findById(req.params.id)
  if (!event) return res.status(404).json({ error: 'Event not found.' })
  // Attendance rows are meaningless once their session is gone — leaving them orphans the roll-call.
  await Promise.all([Attendance.deleteMany({ eventId: event._id }), event.deleteOne()])
  await saveAudit('calendar_event.deleted', 'CalendarEvent', req.params.id, { title: event.title }, req.auth.sub)
  res.status(204).end()
}))

// Built-in attendance — a roll-call roster per calendar session, restricted to events tied to a
// course (attendance needs a learner list to check off, which only a course enrollment gives us).
app.get('/api/staff/calendar-events/:id/attendance', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Attendance requires MongoDB.' })
  const event = await CalendarEvent.findById(req.params.id).lean()
  if (!event) return res.status(404).json({ error: 'Event not found.' })
  if (!event.courseId) return res.status(400).json({ error: 'This event is not linked to a course, so it has no roster to take attendance for.' })
  const progresses = await LearningProgress.find({ courseId: event.courseId }).select('learnerId').lean()
  const learners = await User.find({ _id: { $in: progresses.map((progress) => progress.learnerId) } }).select('name email').sort({ name: 1 }).lean()
  const records = await Attendance.find({ eventId: event._id }).lean()
  const byLearner = new Map(records.map((record) => [String(record.learnerId), record]))
  // recordedAt lets the roll-call screen distinguish "never taken" from "already saved" without
  // inferring it from whether every status happens to be null — a roster legitimately saved as all
  // absent would otherwise look untouched.
  const markedTimes = records.map((record) => record.markedAt).filter(Boolean).map((value) => new Date(value).getTime())
  res.json({
    event: { id: event._id.toString(), title: event.title, startsAt: event.startsAt, courseId: String(event.courseId) },
    recordedAt: markedTimes.length ? new Date(Math.max(...markedTimes)) : null,
    roster: learners.map((learner) => {
      const record = byLearner.get(String(learner._id))
      return { learnerId: learner._id.toString(), name: learner.name, email: learner.email, status: record?.status ?? null, markedAt: record?.markedAt ?? null }
    }),
  })
}))

app.post('/api/staff/calendar-events/:id/attendance', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Attendance requires MongoDB.' })
  const event = await CalendarEvent.findById(req.params.id).lean()
  if (!event) return res.status(404).json({ error: 'Event not found.' })
  if (!event.courseId) return res.status(400).json({ error: 'This event is not linked to a course, so attendance cannot be recorded.' })
  const values = attendanceInput.parse(req.body)
  const now = new Date()
  await Promise.all(values.records.map((record) => Attendance.findOneAndUpdate(
    { eventId: event._id, learnerId: record.learnerId },
    { $set: { courseId: event.courseId, status: record.status, markedBy: req.auth.sub, markedAt: now } },
    { upsert: true, setDefaultsOnInsert: true },
  )))
  await saveAudit('attendance.recorded', 'CalendarEvent', event._id.toString(), { count: values.records.length }, req.auth.sub)
  // Only learners marked present/late can possibly have crossed an attendance-count threshold —
  // an absence never makes a rule newly true, so there's nothing to re-check for those rows.
  const attendedLearnerIds = values.records.filter((record) => ['present', 'late'].includes(record.status)).map((record) => record.learnerId)
  await runBadgeRules(String(event.courseId), attendedLearnerIds, ['attendance_count'])
  res.json({ ok: true, count: values.records.length })
}))

app.get('/api/calendar-events/:id/attendance/me', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Attendance requires MongoDB.' })
  if (req.auth.role !== 'learner') return res.json({ status: null })
  const record = await Attendance.findOne({ eventId: req.params.id, learnerId: req.auth.sub }).select('status markedAt').lean()
  res.json({ status: record?.status ?? null, markedAt: record?.markedAt ?? null })
}))

app.get('/api/search', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.json({ courses: [], announcements: [], users: [] })
  const term = String(req.query.q ?? '').trim()
  if (term.length < 2) return res.json({ courses: [], announcements: [], users: [] })
  const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  const courseFilter = isStaff ? {} : await learnerVisibleCourseFilter(req.auth.sub)
  const searchableCourseIds = isStaff ? undefined : (await Course.find(courseFilter).select('_id').lean()).map((course) => course._id)
  const [courses, announcements, users] = await Promise.all([
    Course.find({ ...courseFilter, $or: [{ title: regex }, { description: regex }] }).select('title slug isPublished').limit(6).lean(),
    Announcement.find({ ...(isStaff ? {} : { courseId: { $in: searchableCourseIds } }), $or: [{ title: regex }, { body: regex }] }).select('title courseId createdAt').limit(6).lean(),
    isStaff ? User.find({ status: 'active', $or: [{ name: regex }, { email: regex }] }).select('name email role avatarUrl').limit(6).lean() : Promise.resolve([]),
  ])
  res.json({
    courses: courses.map((course) => ({ id: course._id, title: course.title, to: `/catalog?course=${course._id}` })),
    announcements: announcements.map((row) => ({ id: row._id, title: row.title, to: '/announcements' })),
    users: users.map((row) => ({ id: row._id, title: row.name, subtitle: row.email, to: `/profile?member=${row._id}` })),
  })
}))

app.get('/api/notifications/me', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Notifications require MongoDB.' })
  const notifications = await Notification.find({ recipientId: req.auth.sub }).sort({ createdAt: -1 }).limit(100).lean()
  res.json(notifications)
}))

app.post('/api/notifications/:id/read', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Notifications require MongoDB.' })
  const notification = await Notification.findOneAndUpdate({ _id: req.params.id, recipientId: req.auth.sub }, { readAt: new Date() }, { new: true })
  if (!notification) return res.status(404).json({ error: 'Notification not found.' })
  res.json(notification)
}))

app.post('/api/notifications/read-all', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Notifications require MongoDB.' })
  await Notification.updateMany({ recipientId: req.auth.sub, readAt: { $exists: false } }, { readAt: new Date() })
  res.json({ ok: true })
}))

app.post('/api/staff/notifications', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Notifications require MongoDB.' })
  const values = notificationBroadcastInput.parse(req.body)
  let recipientIds = values.recipientIds ?? []
  if (!recipientIds.length) {
    const roleFilter = values.audience === 'all_staff' ? { role: { $in: ['instructor', 'admin'] } } : values.audience === 'everyone' ? {} : { role: 'learner' }
    const recipients = await User.find({ ...roleFilter, status: 'active' }).select('_id').lean()
    recipientIds = recipients.map((recipient) => recipient._id)
  }
  const notifications = await Notification.insertMany(recipientIds.map((recipientId) => ({ recipientId, title: values.title, body: values.body, link: values.link })))
  await saveAudit('notification.broadcast', 'Notification', 'bulk', { count: notifications.length, title: values.title }, req.auth.sub)
  res.status(201).json({ count: notifications.length })
}))

app.get('/api/presence', asyncRoute(async (_req, res) => {
  if (!dbState.ready) return res.json([...memory.presence.values()])
  const onlineSince = new Date(Date.now() - 90_000)
  const records = await Presence.find({ lastHeartbeatAt: { $gte: onlineSince } }).populate('userId', 'name role avatarUrl').lean()
  res.json(records.map(({ userId }) => userId).filter(Boolean))
}))

io.on('connection', (socket) => {
  socket.on('presence:heartbeat', async (profile) => {
    if (!profile?.id || !['learner', 'instructor', 'admin'].includes(profile.role)) return
    const record = { id: profile.id, name: profile.name, role: profile.role, avatarUrl: profile.avatarUrl, socketId: socket.id, lastHeartbeatAt: new Date() }
    memory.presence.set(profile.id, record)
    if (dbState.ready && mongoose.isValidObjectId(profile.id)) await Presence.findOneAndUpdate({ userId: profile.id }, { socketId: socket.id, lastHeartbeatAt: record.lastHeartbeatAt }, { upsert: true })
    io.emit('presence:changed', [...memory.presence.values()])
  })
  socket.on('disconnect', () => {
    for (const [userId, entry] of memory.presence) if (entry.socketId === socket.id) memory.presence.delete(userId)
    io.emit('presence:changed', [...memory.presence.values()])
  })
})

app.use((error, _req, res, next) => {
  void next
  if (error instanceof z.ZodError) return res.status(422).json({ error: 'Please check the highlighted fields.', issues: error.issues })
  // A route can raise a deliberate client-facing error via httpError(). `expose` is required as
  // well as `status` so that an internal error which happens to carry a `status` property can never
  // leak its message — anything unmarked still becomes a generic 500.
  if (error?.expose === true && Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: error.message })
  }
  // A malformed :id (anything that isn't a valid ObjectId) makes Mongoose throw before the route can
  // return its own 404. That is a client error, not a server fault — answering 500 and logging a
  // stack trace for every mistyped URL buries real failures in noise.
  if (error?.name === 'CastError' && error.kind === 'ObjectId') return res.status(404).json({ error: 'Not found.' })
  console.error(error)
  res.status(500).json({ error: 'Unexpected server error.' })
})

async function boot() {
  if (config.mongoUri) {
    await mongoose.connect(config.mongoUri)
    dbState.ready = true
    await ensureDefaultEmailTemplates()
    console.log('MongoDB connected')
  } else if (isProduction) {
    throw new Error('MONGODB_URI is required in production.')
  } else {
    console.warn('MONGODB_URI is not set. Running with development-only in-memory records.')
  }
  // Managed hosts (Render, Vercel, Fly) give each instance an ephemeral filesystem, so anything
  // written to disk — including signed enrollment agreements and certificates — disappears on the
  // next restart or redeploy. Refuse to start rather than silently destroy legal records.
  if (isProduction && !isObjectStorage) {
    throw new Error('S3_BUCKET/S3_ACCESS_KEY_ID are required in production: local disk storage would lose signed agreements and certificates on every redeploy.')
  }
  console.log(isObjectStorage ? `File storage: S3 bucket "${config.storage.s3.bucket}"` : `File storage: local disk (${config.storage.privateDirectory})`)
  server.listen(config.port, () => console.log(`Tree Academy API listening on :${config.port}`))
}

boot().catch((error) => { console.error(error); process.exit(1) })
