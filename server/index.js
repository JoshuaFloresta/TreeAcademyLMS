import http from 'node:http'
import path from 'node:path'
import express from 'express'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { Server } from 'socket.io'
import { z } from 'zod'
import { config, integrations, isAllowedOrigin, isProduction } from './config.js'
import { catalog } from './catalog.js'
import { Announcement, Assignment, Attendance, Badge, BadgeRule, CalendarEvent, Category, CategoryHeader, Certificate, CertificateTemplate, ContentAsset, Course, CourseEnrollment, EmailTemplate, Enrollment, ForumPost, ForumReaction, ForumThread, LearningModule, LearningProgress, Lesson, Module, NewsletterSubscriber, Notification, Presence, Quiz, QuizAttempt, Report, RolePermission, StudentBadge, Submission, SubmissionComment, SupportTicket, Webinar, WebinarRegistration, AuditLog, RefreshToken, User } from './models.js'
import { requireAdmin, requireAuth, requireStaff } from './security.js'
import { emailTemplateDefaults, ensureDefaultEmailTemplates, sampleVarsFor, sendTemplatedEmail } from './email.js'
import { renderCertificate, saveCertificateTemplate, saveSubmissionAttachment } from './certificates.js'
import { extractAgreementFields, saveAgreementTemplate } from './enrollment-documents.js'
import { PUBLIC_PREFIX, getFile, isObjectStorage } from './storage.js'
import { dbState, memory } from './state.js'
import { asyncRoute, requireDb, sendPrivateDownload } from './lib/http.js'
import { agreementTemplateUpload, avatarUpload, bannerUpload, certificateUpload, forumImageUpload, saveAvatarUpload, saveBannerUpload, saveForumImageUpload, submissionUpload } from './lib/uploads.js'
import { saveAudit } from './lib/audit.js'
import { notifyUsers } from './lib/notify.js'
import { bestEffortEmail, issueAccountSetupUrl, sendCredentialsEmail } from './lib/accounts.js'
import { issueSession, sessionUser } from './lib/session.js'
import { blankToNull, usernameField } from './lib/zod-helpers.js'
import { courseIsAvailable, learnerVisibleCourseFilter, visibleCourses } from './lib/course-visibility.js'
import { RESERVED_COURSE_SLUGS, provisionLearnerAccount, sendPaymentReceiptEmail } from './lib/enrollment-shared.js'
import { router as authRouter } from './routes/auth.js'
import { router as usersRouter } from './routes/users.js'
import { router as enrollmentRouter } from './routes/enrollment.js'
import { router as adminVouchersRouter } from './routes/admin-vouchers.js'
import { router as billingRouter } from './routes/billing.js'
import { router as webhooksRouter } from './routes/webhooks.js'

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

const newsletterInput = z.object({ email: z.string().email().max(254) })
const badgeInput = z.object({ title: z.string().trim().min(2).max(120), description: z.string().trim().max(400).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), icon: z.string().trim().max(40).optional() })
const awardInput = z.object({ learnerId: z.string().min(1), note: z.string().trim().max(400).optional() })
// Each trigger type needs different fields — validated as one flat object rather than a
// discriminated union so the client can send a single, simple form payload; the per-type fields
// that don't apply are just left undefined and ignored by the evaluator.
const badgeRuleShape = z.object({
  badgeId: z.string().trim().min(1),
  courseId: z.string().trim().min(1),
  trigger: z.object({
    type: z.enum(['course_completion', 'module_milestone', 'score_threshold', 'attendance_count']),
    moduleId: z.string().trim().min(1).optional(),
    targetKind: z.enum(['assignment', 'quiz']).optional(),
    targetId: z.string().trim().min(1).optional(),
    minPercent: z.coerce.number().min(0).max(100).optional(),
    minAttendance: z.coerce.number().int().min(1).max(500).optional(),
  }),
  targetScope: z.enum(['course', 'selected']).optional(),
  learnerIds: z.array(z.string().trim().min(1)).max(500).optional(),
  isActive: z.boolean().optional(),
})
const badgeRuleInput = badgeRuleShape
  .refine((value) => value.trigger.type !== 'module_milestone' || value.trigger.moduleId, { message: 'Choose which module completes this rule.', path: ['trigger', 'moduleId'] })
  .refine((value) => value.trigger.type !== 'score_threshold' || (value.trigger.targetKind && value.trigger.targetId && value.trigger.minPercent != null), { message: 'Choose an assignment or quiz and a minimum score.', path: ['trigger', 'targetId'] })
  .refine((value) => value.trigger.type !== 'attendance_count' || value.trigger.minAttendance, { message: 'Enter how many sessions are required.', path: ['trigger', 'minAttendance'] })
  .refine((value) => value.targetScope !== 'selected' || (value.learnerIds && value.learnerIds.length), { message: 'Pick at least one learner.', path: ['learnerIds'] })
// Loosely validated: a PATCH that only flips `isActive` shouldn't have to re-satisfy every
// cross-field rule above. The evaluator treats an incompletely-configured rule as never matching,
// so a half-edited trigger fails safe (nothing gets awarded) rather than erroring the request.
const badgeRuleUpdateInput = badgeRuleShape.partial().extend({ trigger: badgeRuleShape.shape.trigger.partial().optional() })
const certificateIssueInput = z.object({ templateId: z.string().min(1), learnerId: z.string().min(1) })
const certificateTemplateInput = z.object({ title: z.string().trim().min(2).max(160), scope: z.enum(['module', 'program']), targetId: z.string().min(1), nameX: z.coerce.number().min(0).max(2000).optional(), nameY: z.coerce.number().min(0).max(2000).optional(), nameSize: z.coerce.number().min(10).max(120).optional() })

const courseInput = z.object({
  title: z.string().trim().min(2).max(160),
  slug: z.string().trim().min(2).max(160).regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers, and hyphens only.'),
  programId: z.string().trim().min(1).optional(),
  description: z.string().trim().max(2000).optional(),
  isPublished: z.boolean().optional(),
  availableFrom: z.coerce.date().nullable().optional(),
  availableUntil: z.coerce.date().nullable().optional(),
  bannerPreset: z.string().trim().max(60).nullable().optional(),
})
const courseUpdateInput = courseInput.partial()
const moduleInput = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  phaseNumber: z.coerce.number().int().min(1).max(99).nullable().optional(),
  position: z.coerce.number().int().min(0),
  isPublished: z.boolean().optional(),
})
const moduleUpdateInput = moduleInput.partial()
const lessonInput = z.object({
  title: z.string().trim().min(2).max(160),
  kind: z.enum(['article', 'video', 'document', 'link', 'header']).optional(),
  body: z.string().trim().max(20000).optional(),
  resourceKey: z.string().trim().max(500).optional(),
  driveUrl: z.string().trim().url().max(500).nullable().optional(),
  position: z.coerce.number().int().min(0),
  isPublished: z.boolean().optional(),
})
const lessonUpdateInput = lessonInput.partial()
const assignmentInput = z.object({
  title: z.string().trim().min(2).max(160),
  moduleId: z.string().trim().min(1),
  lessonId: z.string().trim().min(1).nullable().optional(),
  instructions: z.string().trim().max(20000).optional(),
  instructionsUrl: z.string().trim().url().max(500).nullable().optional(),
  dueAt: z.coerce.date().optional(),
  maxPoints: z.coerce.number().min(1).max(1000).optional(),
  submissionType: z.enum(['text', 'file', 'both']).optional(),
  position: z.coerce.number().int().min(0).optional(),
})
const assignmentUpdateInput = assignmentInput.partial()
const gradeInput = z.object({
  grade: z.coerce.number().min(0).max(1000),
  feedback: z.string().trim().max(2000).optional(),
})
const submissionCommentInput = z.object({ body: z.string().trim().min(1).max(4000) })
const choicesQuestionInput = z.object({
  type: z.enum(['multiple_choice', 'true_false']),
  prompt: z.string().trim().min(2).max(10000),
  choices: z.array(z.string().trim().min(1).max(300)).min(2).max(6),
  answerIndex: z.coerce.number().int().min(0),
  explanation: z.string().trim().max(10000).optional(),
}).refine((value) => value.answerIndex < value.choices.length, { message: 'answerIndex must reference one of the choices.' })
const fillBlankQuestionInput = z.object({
  type: z.literal('fill_blank'),
  prompt: z.string().trim().min(2).max(10000),
  acceptableAnswers: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  explanation: z.string().trim().max(10000).optional(),
})
const essayQuestionInput = z.object({
  type: z.literal('essay'),
  prompt: z.string().trim().min(2).max(10000),
  explanation: z.string().trim().max(10000).optional(),
})
const matchingQuestionInput = z.object({
  type: z.literal('matching'),
  prompt: z.string().trim().min(2).max(10000),
  pairs: z.array(z.object({ left: z.string().trim().min(1).max(200), right: z.string().trim().min(1).max(200) })).min(2).max(12),
  explanation: z.string().trim().max(10000).optional(),
})
const enumerationQuestionInput = z.object({
  type: z.literal('enumeration'),
  prompt: z.string().trim().min(2).max(10000),
  acceptableAnswers: z.array(z.string().trim().min(1).max(200)).min(1).max(30),
  minAnswers: z.coerce.number().int().min(1).max(30),
  explanation: z.string().trim().max(10000).optional(),
}).refine((value) => value.minAnswers <= value.acceptableAnswers.length, { message: 'minAnswers cannot exceed the number of acceptable answers.' })
const quizQuestionInput = z.discriminatedUnion('type', [choicesQuestionInput, fillBlankQuestionInput, essayQuestionInput, matchingQuestionInput, enumerationQuestionInput])
const quizInput = z.object({
  title: z.string().trim().min(2).max(160),
  moduleId: z.string().trim().min(1).nullable().optional(),
  position: z.coerce.number().int().min(0).optional(),
  questions: z.array(quizQuestionInput).min(1).max(50),
  isPublished: z.boolean().optional(),
})
const quizUpdateInput = quizInput.partial()
// Answer shape depends on the question's type (number for multiple_choice/true_false, string for
// fill_blank/essay, string array for enumeration, object for matching) — validated per-question
// against the quiz at grading time instead of a single fixed shape here.
const quizAttemptInput = z.object({ answers: z.array(z.any()).min(1) })
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

const adminUserCreateInput = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  username: usernameField.optional(),
  role: z.enum(['learner', 'instructor', 'admin']).optional(),
  courseIds: z.array(z.string().trim().min(1)).max(100).optional(),
})
const categoryInput = z.object({ title: z.string().trim().min(2).max(160), description: z.string().trim().max(2000).optional(), bannerPreset: z.string().trim().max(60).optional(), bannerUrl: z.string().trim().url().max(1000).optional(), position: z.coerce.number().int().min(0) })
const categoryUpdateInput = categoryInput.partial().extend({ status: z.enum(['draft', 'published', 'archived']).optional() })
const categoryHeaderInput = z.object({ title: z.string().trim().min(2).max(160), position: z.coerce.number().int().min(0) })
const learningModuleInput = z.object({ type: z.enum(['file', 'quiz', 'assignment']), title: z.string().trim().min(2).max(160), instructions: z.string().trim().max(5000).optional(), resourceUrl: z.string().trim().url().max(1000).optional(), position: z.coerce.number().int().min(0), quiz: z.object({ questions: z.array(z.object({ prompt: z.string().trim().min(2).max(1000), choices: z.array(z.string().trim().min(1).max(300)).min(2).max(6), answerIndex: z.coerce.number().int().min(0) })).max(50).optional(), passingScore: z.coerce.number().min(0).max(100).optional() }).optional(), assignment: z.object({ maxPoints: z.coerce.number().min(1).max(1000).optional(), rubric: z.string().trim().max(5000).optional(), feedbackTemplate: z.string().trim().max(2000).optional() }).optional() })
const learningModuleUpdateInput = learningModuleInput.partial().extend({ status: z.enum(['draft', 'published', 'archived']).optional() })
const adminUserUpdateInput = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().email().max(254).optional(),
  username: usernameField.nullable().optional(),
  // Uploaded avatars use API-relative paths; admins may also provide an absolute image URL.
  avatarUrl: z.string().trim().max(500).refine((value) => value.startsWith('/uploads/avatars/') || /^https?:\/\//.test(value), 'Use an uploaded avatar or an http(s) image URL.').nullable().optional(),
  role: z.enum(['learner', 'instructor', 'admin']).optional(),
  status: z.enum(['invited', 'active', 'inactive', 'suspended']).optional(),
  mustChangePassword: z.boolean().optional(),
})
const adminPasswordInput = z.object({ password: z.string().min(10).max(128) })
const bulkUserActionInput = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(200),
  action: z.enum(['activate', 'deactivate', 'suspend', 'delete']),
})
const bulkEnrollInput = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(200),
  courseId: z.string().trim().min(1),
})
const userImportInput = z.object({
  rows: z.array(z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().email().max(254),
    role: z.enum(['learner', 'instructor', 'admin']).optional(),
  })).min(1).max(500),
})
const adminCourseInput = z.object({
  isPublished: z.boolean().optional(),
  archived: z.boolean().optional(),
  availableFrom: z.coerce.date().nullable().optional(),
  availableUntil: z.coerce.date().nullable().optional(),
  showEnrollmentCount: z.boolean().optional(),
})
const courseReviewInput = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(2000).optional() })
const webinarInput = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional(),
  startsAt: z.coerce.date(),
  registrationDeadline: z.coerce.date().nullable().optional(),
  capacity: z.coerce.number().int().min(1).nullable().optional(),
  isPublished: z.boolean().optional(),
})
const webinarUpdateInput = webinarInput.partial()
const webinarRegisterInput = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(254) })
const emailTemplateUpdateInput = z.object({
  subject: z.string().trim().min(2).max(200).optional(),
  body: z.string().trim().min(2).max(20000).optional(),
  fromName: z.string().trim().max(100).optional(),
  fromEmail: z.string().trim().max(254).refine((value) => value === '' || z.string().email().safeParse(value).success, 'Invalid email address').optional(),
  enabled: z.boolean().optional(),
})
// Blank is allowed and means "send it to me" — the route resolves it to the requesting admin's own
// address rather than requiring them to retype it every time.
const testEmailInput = z.object({
  to: z.string().trim().max(254).refine((value) => value === '' || z.string().email().safeParse(value).success, 'Enter a valid email address.').optional(),
})
const permissionsInput = z.object({
  learner: z.array(z.string().trim().max(60)).max(60),
  instructor: z.array(z.string().trim().max(60)).max(60),
  admin: z.array(z.string().trim().max(60)).max(60),
})
const contentAssetInput = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).optional(),
  category: z.enum(['template', 'document', 'video', 'image', 'link', 'other']).optional(),
  url: z.string().trim().max(1000).optional(),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
})
const supportTicketInput = z.object({
  subject: z.string().trim().min(2).max(160),
  category: z.enum(['account', 'billing', 'technical', 'course', 'other']).optional(),
  message: z.string().trim().min(2).max(4000),
})
const supportUpdateInput = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  response: z.string().trim().max(4000).optional(),
})
const reportInput = z.object({
  type: z.enum(['progress', 'issue', 'feedback', 'incident', 'other']).optional(),
  title: z.string().trim().min(2).max(160),
  details: z.string().trim().min(2).max(4000),
})
const reportUpdateInput = z.object({
  status: z.enum(['submitted', 'reviewing', 'actioned', 'dismissed']).optional(),
  reviewNote: z.string().trim().max(2000).optional(),
})
const bulkDecisionInput = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(100),
  decision: z.enum(['approved', 'rejected', 'refunded']),
  reason: z.string().trim().max(500).optional(),
})

async function issueCertificate({ template, learner, issuedBy }) {
  const existing = await Certificate.findOne({ templateId: template._id, learnerId: learner._id })
  if (existing) return existing
  const fileKey = await renderCertificate(template, learner)
  const certificate = await Certificate.create({ templateId: template._id, learnerId: learner._id, recipientName: learner.name, targetId: template.targetId, fileKey, issuedBy })
  await saveAudit('certificate.issued', 'Certificate', certificate.id, { templateId: template.id, learnerId: learner.id }, issuedBy)
  return certificate
}

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

// --- Admin console: user management, catalog, roles, audit, content, support, analytics, reports ---

const adminOnly = [requireAuth, requireAdmin]

const DEFAULT_PERMISSIONS = {
  learner: ['courses.view', 'assignments.submit', 'quizzes.attempt', 'certificates.view', 'support.submit', 'reports.submit'],
  instructor: ['courses.view', 'courses.manage', 'assignments.grade', 'quizzes.manage', 'enrollments.review', 'recognition.award', 'support.submit', 'reports.submit'],
  admin: ['users.manage', 'catalog.manage', 'roles.manage', 'enrollments.manage', 'audit.view', 'content.manage', 'support.manage', 'analytics.view', 'reports.manage'],
}

async function loadPermissions() {
  const saved = await RolePermission.find().lean()
  const byRole = Object.fromEntries(saved.map((row) => [row.role, row.permissions]))
  return {
    learner: byRole.learner ?? DEFAULT_PERMISSIONS.learner,
    instructor: byRole.instructor ?? DEFAULT_PERMISSIONS.instructor,
    admin: byRole.admin ?? DEFAULT_PERMISSIONS.admin,
  }
}

const adminUserView = (user) => ({
  id: user._id?.toString() ?? user.id, name: user.name, email: user.email, username: user.username ?? null,
  role: user.role, status: user.status, avatarUrl: user.avatarUrl ?? null, mustChangePassword: user.mustChangePassword,
  lastSeenAt: user.lastSeenAt, createdAt: user.createdAt,
})

app.get('/api/admin/users', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  const query = {}
  if (['learner', 'instructor', 'admin'].includes(req.query.role)) query.role = req.query.role
  if (['invited', 'active', 'inactive', 'suspended'].includes(req.query.status)) query.status = req.query.status
  if (req.query.search) query.$or = [{ name: new RegExp(String(req.query.search).slice(0, 60), 'i') }, { email: new RegExp(String(req.query.search).slice(0, 60), 'i') }, { username: new RegExp(String(req.query.search).slice(0, 60), 'i') }]
  if (mongoose.isValidObjectId(req.query.course)) {
    const enrolled = await LearningProgress.find({ courseId: req.query.course }).distinct('learnerId')
    query._id = { $in: enrolled }
  }
  const users = await User.find(query).sort({ createdAt: -1 }).limit(500).lean()
  res.json(users.map(adminUserView))
}))

app.post('/api/admin/users', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  const values = adminUserCreateInput.parse(req.body)
  if (await User.findOne({ email: values.email })) return res.status(409).json({ error: 'A user with that email already exists.' })
  if (values.username && await User.findOne({ username: values.username })) return res.status(409).json({ error: 'That username is already taken.' })
  const user = await User.create({
    name: values.name, email: values.email, username: values.username, role: values.role ?? 'learner', status: 'active',
  })
  if (user.role === 'instructor' && values.courseIds?.length) {
    await Course.updateMany({ _id: { $in: values.courseIds } }, { $addToSet: { assignedInstructorIds: user._id } })
  }
  const setupUrl = await issueAccountSetupUrl(user)
  const delivery = await bestEffortEmail(sendCredentialsEmail({ name: user.name, email: user.email, setupUrl }), 'enrollment_credentials email')
  await saveAudit('user.created', 'User', user.id, { role: user.role }, req.auth.sub)
  res.status(201).json({ user: adminUserView(user), setupUrl, delivery: delivery?.delivery ?? 'unknown' })
}))

app.post('/api/admin/users/import', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  const { rows } = userImportInput.parse(req.body)
  const created = []
  const skipped = []
  for (const row of rows) {
    const email = row.email.toLowerCase()
    if (await User.findOne({ email })) { skipped.push({ email, reason: 'already exists' }); continue }
    const user = await User.create({ name: row.name, email, role: row.role ?? 'learner', status: 'active' })
    const setupUrl = await issueAccountSetupUrl(user)
    await bestEffortEmail(sendCredentialsEmail({ name: user.name, email: user.email, setupUrl }), 'enrollment_credentials email')
    created.push({ email: user.email, setupUrl })
  }
  await saveAudit('user.imported', 'User', 'bulk', { created: created.length, skipped: skipped.length }, req.auth.sub)
  res.status(201).json({ created, skipped })
}))

app.patch('/api/admin/users/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  if (req.params.id === req.auth.sub) return res.status(409).json({ error: 'You cannot change your own account here.' })
  const updates = adminUserUpdateInput.parse(req.body)
  if (updates.email && await User.findOne({ email: updates.email.toLowerCase(), _id: { $ne: req.params.id } })) return res.status(409).json({ error: 'Another user already uses that email.' })
  if (updates.username && await User.findOne({ username: updates.username, _id: { $ne: req.params.id } })) return res.status(409).json({ error: 'That username is already taken.' })
  const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true })
  if (!user) return res.status(404).json({ error: 'User not found.' })
  if (['suspended', 'inactive'].includes(updates.status)) await RefreshToken.deleteMany({ userId: user._id })
  await saveAudit('user.updated', 'User', user.id, updates, req.auth.sub)
  res.json(adminUserView(user))
}))

app.post('/api/admin/users/:id/avatar', ...adminOnly, avatarUpload.single('avatar'), asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  if (!req.file) return res.status(400).json({ error: 'Choose a JPG, PNG, or WEBP image under 3MB.' })
  const avatarUrl = await saveAvatarUpload(req.file)
  const user = await User.findByIdAndUpdate(req.params.id, { avatarUrl }, { new: true })
  if (!user) return res.status(404).json({ error: 'User not found.' })
  await saveAudit('user.avatar_updated', 'User', user.id, {}, req.auth.sub)
  res.json(adminUserView(user))
}))

app.delete('/api/admin/users/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  if (req.params.id === req.auth.sub) return res.status(409).json({ error: 'You cannot delete your own account.' })
  const user = await User.findById(req.params.id)
  if (!user) return res.status(404).json({ error: 'User not found.' })
  await Promise.all([
    RefreshToken.deleteMany({ userId: user._id }),
    LearningProgress.deleteMany({ learnerId: user._id }),
    Submission.deleteMany({ learnerId: user._id }),
    StudentBadge.deleteMany({ learnerId: user._id }),
    Presence.deleteMany({ userId: user._id }),
    user.deleteOne(),
  ])
  await saveAudit('user.deleted', 'User', req.params.id, { email: user.email, role: user.role }, req.auth.sub)
  res.status(204).end()
}))

app.post('/api/admin/users/bulk-action', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  const { ids, action } = bulkUserActionInput.parse(req.body)
  const targetIds = ids.filter((value) => value !== req.auth.sub)
  if (action === 'delete') {
    const users = await User.find({ _id: { $in: targetIds } }).select('_id').lean()
    const userIds = users.map((u) => u._id)
    await Promise.all([
      RefreshToken.deleteMany({ userId: { $in: userIds } }),
      LearningProgress.deleteMany({ learnerId: { $in: userIds } }),
      Submission.deleteMany({ learnerId: { $in: userIds } }),
      StudentBadge.deleteMany({ learnerId: { $in: userIds } }),
      Presence.deleteMany({ userId: { $in: userIds } }),
      User.deleteMany({ _id: { $in: userIds } }),
    ])
  } else {
    const status = action === 'activate' ? 'active' : action === 'suspend' ? 'suspended' : 'inactive'
    await User.updateMany({ _id: { $in: targetIds } }, { status })
    if (status !== 'active') await RefreshToken.deleteMany({ userId: { $in: targetIds } })
  }
  await saveAudit(`user.bulk_${action}`, 'User', 'bulk', { count: targetIds.length }, req.auth.sub)
  res.json({ processed: targetIds.length })
}))

app.post('/api/admin/users/bulk-enroll', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  const { ids, courseId } = bulkEnrollInput.parse(req.body)
  if (!mongoose.isValidObjectId(courseId) || !(await Course.findById(courseId))) return res.status(404).json({ error: 'Course not found.' })
  const learners = await User.find({ _id: { $in: ids }, role: 'learner' }).select('_id').lean()
  await Promise.all(learners.map((learner) => LearningProgress.findOneAndUpdate(
    { learnerId: learner._id, courseId }, { $setOnInsert: { completedModuleIds: [] } }, { upsert: true, setDefaultsOnInsert: true })))
  await saveAudit('user.bulk_enrolled', 'Course', courseId, { count: learners.length }, req.auth.sub)
  res.json({ enrolled: learners.length })
}))

app.post('/api/admin/users/:id/password', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  const { password } = adminPasswordInput.parse(req.body)
  const user = await User.findById(req.params.id)
  if (!user) return res.status(404).json({ error: 'User not found.' })
  user.passwordHash = await bcrypt.hash(password, 12)
  user.mustChangePassword = true
  await user.save()
  await RefreshToken.deleteMany({ userId: user._id })
  await saveAudit('user.password_reset', 'User', user.id, {}, req.auth.sub)
  res.status(204).end()
}))

app.get('/api/admin/users/:id/courses', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  const [courses, progress] = await Promise.all([
    Course.find().select('title slug isPublished').sort({ createdAt: -1 }).lean(),
    LearningProgress.find({ learnerId: req.params.id }).select('courseId completedModuleIds completedAt').lean(),
  ])
  const enrolledMap = new Map(progress.map((row) => [String(row.courseId), row]))
  res.json(courses.map((course) => ({
    id: course._id.toString(), title: course.title, slug: course.slug, isPublished: course.isPublished,
    enrolled: enrolledMap.has(String(course._id)),
    completedModules: enrolledMap.get(String(course._id))?.completedModuleIds?.length ?? 0,
    completedAt: enrolledMap.get(String(course._id))?.completedAt ?? null,
  })))
}))

app.post('/api/admin/users/:id/courses', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  const { courseId } = z.object({ courseId: z.string().trim().min(1) }).parse(req.body)
  if (!mongoose.isValidObjectId(courseId) || !(await Course.findById(courseId))) return res.status(404).json({ error: 'Course not found.' })
  await LearningProgress.findOneAndUpdate({ learnerId: req.params.id, courseId }, { $setOnInsert: { completedModuleIds: [] } }, { upsert: true, setDefaultsOnInsert: true })
  await saveAudit('user.enrolled', 'Course', courseId, { learnerId: req.params.id }, req.auth.sub)
  res.status(201).json({ enrolled: true })
}))

app.delete('/api/admin/users/:id/courses/:courseId', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  await LearningProgress.deleteOne({ learnerId: req.params.id, courseId: req.params.courseId })
  await saveAudit('user.unenrolled', 'Course', req.params.courseId, { learnerId: req.params.id }, req.auth.sub)
  res.status(204).end()
}))

app.get('/api/admin/users/:id/teaching-courses', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  const instructor = await User.findById(req.params.id).select('role')
  if (!instructor) return res.status(404).json({ error: 'User not found.' })
  if (instructor.role !== 'instructor') return res.status(409).json({ error: 'Only instructors can be assigned teaching courses.' })
  const courses = await Course.find().select('title slug assignedInstructorIds').sort({ title: 1 }).lean()
  res.json(courses.map((course) => ({ id: String(course._id), title: course.title, slug: course.slug, assigned: (course.assignedInstructorIds ?? []).some((id) => String(id) === req.params.id) })))
}))

app.put('/api/admin/users/:id/teaching-courses', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  const { courseIds } = z.object({ courseIds: z.array(z.string().trim().min(1)).max(100) }).parse(req.body)
  const instructor = await User.findById(req.params.id).select('role')
  if (!instructor) return res.status(404).json({ error: 'User not found.' })
  if (instructor.role !== 'instructor') return res.status(409).json({ error: 'Only instructors can be assigned teaching courses.' })
  await Course.updateMany({ assignedInstructorIds: instructor._id }, { $pull: { assignedInstructorIds: instructor._id } })
  if (courseIds.length) await Course.updateMany({ _id: { $in: courseIds } }, { $addToSet: { assignedInstructorIds: instructor._id } })
  await saveAudit('instructor.courses_assigned', 'User', instructor.id, { courseIds }, req.auth.sub)
  res.json({ courseIds })
}))

app.post('/api/admin/users/:id/impersonate', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  if (req.params.id === req.auth.sub) return res.status(409).json({ error: 'You are already signed in as yourself.' })
  const target = await User.findById(req.params.id)
  if (!target) return res.status(404).json({ error: 'User not found.' })
  if (target.status !== 'active') return res.status(409).json({ error: 'Only active accounts can be impersonated.' })
  const admin = await User.findById(req.auth.sub).select('name')
  const accessToken = await issueSession(res, target, req.auth.sub)
  await saveAudit('user.impersonation_started', 'User', target.id, {}, req.auth.sub)
  res.json({ accessToken, user: sessionUser(target, { impersonating: true, impersonatorName: admin?.name }) })
}))

app.get('/api/admin/courses', ...adminOnly, asyncRoute(async (_req, res) => {
  if (!dbState.ready) return requireDb(res, 'Catalog management')
  const courses = await Course.find().sort({ createdAt: -1 }).lean()
  const [counts, enrollCounts] = await Promise.all([
    Module.aggregate([{ $group: { _id: '$courseId', count: { $sum: 1 } } }]),
    LearningProgress.aggregate([{ $group: { _id: '$courseId', count: { $sum: 1 } } }]),
  ])
  const countMap = new Map(counts.map((row) => [String(row._id), row.count]))
  const enrollMap = new Map(enrollCounts.map((row) => [String(row._id), row.count]))
  res.json(courses.map((course) => ({
    id: course._id.toString(), title: course.title, slug: course.slug, description: course.description,
    bannerPreset: course.bannerPreset ?? null, bannerUrl: course.bannerUrl ?? null,
    isPublished: course.isPublished, archivedAt: course.archivedAt ?? null,
    availableFrom: course.availableFrom ?? null, availableUntil: course.availableUntil ?? null,
    showEnrollmentCount: course.showEnrollmentCount !== false,
    approvalStatus: course.approvalStatus ?? 'draft', reviewNote: course.reviewNote ?? null,
    enrolledCount: enrollMap.get(String(course._id)) ?? 0,
    moduleCount: countMap.get(String(course._id)) ?? 0, createdAt: course.createdAt,
    // Only the filename/upload date — never the storage key, same rule as every other private file.
    agreementTemplate: course.agreementTemplate?.fileKey ? { originalName: course.agreementTemplate.originalName, uploadedAt: course.agreementTemplate.uploadedAt } : null,
  })))
}))

app.patch('/api/admin/courses/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Catalog management')
  const { isPublished, archived, availableFrom, availableUntil, showEnrollmentCount } = adminCourseInput.parse(req.body)
  const updates = {}
  if (isPublished !== undefined) updates.isPublished = isPublished
  if (archived !== undefined) updates.archivedAt = archived ? new Date() : null
  if (availableFrom !== undefined) updates.availableFrom = availableFrom
  if (availableUntil !== undefined) updates.availableUntil = availableUntil
  if (showEnrollmentCount !== undefined) updates.showEnrollmentCount = showEnrollmentCount
  const course = await Course.findByIdAndUpdate(req.params.id, updates, { new: true })
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  await saveAudit('course.moderated', 'Course', course.id, updates, req.auth.sub)
  res.json({
    id: course.id, isPublished: course.isPublished, archivedAt: course.archivedAt ?? null,
    availableFrom: course.availableFrom ?? null, availableUntil: course.availableUntil ?? null,
    showEnrollmentCount: course.showEnrollmentCount !== false,
  })
}))

app.delete('/api/admin/courses/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Catalog management')
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const modules = await Module.find({ courseId: course._id }).select('_id').lean()
  const moduleIds = modules.map((m) => m._id)
  await Promise.all([
    Lesson.deleteMany({ moduleId: { $in: moduleIds } }),
    Module.deleteMany({ courseId: course._id }),
    Assignment.deleteMany({ courseId: course._id }),
    Quiz.deleteMany({ courseId: course._id }),
    course.deleteOne(),
  ])
  await saveAudit('course.deleted', 'Course', req.params.id, { title: course.title }, req.auth.sub)
  res.status(204).end()
}))

app.get('/api/admin/webinars', ...adminOnly, asyncRoute(async (_req, res) => {
  if (!dbState.ready) return requireDb(res, 'Webinar management')
  const webinars = await Webinar.find().sort({ startsAt: 1 }).lean()
  const counts = await WebinarRegistration.aggregate([{ $group: { _id: '$webinarId', count: { $sum: 1 } } }])
  const countById = new Map(counts.map((row) => [String(row._id), row.count]))
  res.json(webinars.map((webinar) => ({
    id: webinar._id.toString(), title: webinar.title, description: webinar.description ?? '',
    startsAt: webinar.startsAt, registrationDeadline: webinar.registrationDeadline ?? null,
    capacity: webinar.capacity ?? null, isPublished: webinar.isPublished,
    registeredCount: countById.get(String(webinar._id)) ?? 0, createdAt: webinar.createdAt,
  })))
}))

app.post('/api/admin/webinars', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Webinar management')
  const webinar = await Webinar.create({ ...webinarInput.parse(req.body), createdBy: req.auth.sub })
  await saveAudit('webinar.created', 'Webinar', webinar.id, {}, req.auth.sub)
  res.status(201).json(webinar)
}))

app.patch('/api/admin/webinars/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Webinar management')
  const webinar = await Webinar.findByIdAndUpdate(req.params.id, webinarUpdateInput.parse(req.body), { new: true })
  if (!webinar) return res.status(404).json({ error: 'Webinar not found.' })
  await saveAudit('webinar.updated', 'Webinar', webinar.id, {}, req.auth.sub)
  res.json(webinar)
}))

app.delete('/api/admin/webinars/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Webinar management')
  const webinar = await Webinar.findByIdAndDelete(req.params.id)
  if (!webinar) return res.status(404).json({ error: 'Webinar not found.' })
  await WebinarRegistration.deleteMany({ webinarId: webinar._id })
  await saveAudit('webinar.deleted', 'Webinar', webinar.id, {}, req.auth.sub)
  res.status(204).end()
}))

app.get('/api/admin/webinars/:id/registrations', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Webinar management')
  const registrations = await WebinarRegistration.find({ webinarId: req.params.id }).sort({ createdAt: -1 }).lean()
  res.json(registrations)
}))

app.get('/api/admin/email-templates', ...adminOnly, asyncRoute(async (_req, res) => {
  if (!dbState.ready) return requireDb(res, 'Email automation')
  const templates = await EmailTemplate.find().lean()
  const byKey = new Map(templates.map((template) => [template.key, template]))
  res.json(Object.keys(emailTemplateDefaults).map((key) => {
    const template = byKey.get(key)
    return template
      ? { key, subject: template.subject, body: template.body, fromName: template.fromName ?? '', fromEmail: template.fromEmail ?? '', enabled: template.enabled, updatedAt: template.updatedAt }
      : { key, ...emailTemplateDefaults[key], fromName: '', fromEmail: '', enabled: true, updatedAt: null }
  }))
}))

app.patch('/api/admin/email-templates/:key', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Email automation')
  if (!Object.hasOwn(emailTemplateDefaults, req.params.key)) return res.status(404).json({ error: 'Unknown email template.' })
  const updates = emailTemplateUpdateInput.parse(req.body)
  const template = await EmailTemplate.findOneAndUpdate({ key: req.params.key }, { ...updates, updatedBy: req.auth.sub }, { new: true, upsert: true, setDefaultsOnInsert: true })
  await saveAudit('email_template.updated', 'EmailTemplate', req.params.key, {}, req.auth.sub)
  res.json(template)
}))

// Fires one template at a real inbox with stand-in data, so an admin can see what they've written
// before a learner does. Rate-limited independently of the global limiter: this is the only route
// in the app that sends academy-branded mail to an address of the caller's choosing, and it is
// audited with both the sender and the recipient for the same reason.
const testEmailLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many test emails. Please wait a few minutes before sending another.' },
})

app.post('/api/admin/email-templates/:key/test', ...adminOnly, testEmailLimiter, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Email automation')
  if (!Object.hasOwn(emailTemplateDefaults, req.params.key)) return res.status(404).json({ error: 'Unknown email template.' })
  const { to } = testEmailInput.parse(req.body ?? {})
  // Defaults to the admin's own address: the common case is "show me what this looks like", and it
  // means a mistyped body can't reach anyone else by accident.
  const sender = await User.findById(req.auth.sub).select('email').lean()
  const recipient = to || sender?.email
  if (!recipient) return res.status(422).json({ error: 'Enter an address to send the test to.' })

  // Sends what is SAVED, not what is in the editor — the admin console has no way to render an
  // unsaved draft, and a test that silently used different content than the stored template would
  // prove nothing about what learners actually receive. The UI warns when there are unsaved edits.
  const result = await sendTemplatedEmail(req.params.key, recipient, sampleVarsFor(req.params.key), {
    ignoreDisabled: true,
    subjectPrefix: '[Test] ',
  })
  if (result.delivery === 'configuration_required') {
    return res.status(503).json({ error: 'Email sending is not configured on this server (RESEND_API_KEY / EMAIL_FROM). The template was not sent.' })
  }
  await saveAudit('email_template.test_sent', 'EmailTemplate', req.params.key, { to: recipient }, req.auth.sub)
  res.json({ delivery: result.delivery, to: recipient })
}))

app.get('/api/admin/permissions', ...adminOnly, asyncRoute(async (_req, res) => {
  if (!dbState.ready) return res.json(DEFAULT_PERMISSIONS)
  res.json(await loadPermissions())
}))

app.put('/api/admin/permissions', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Role permissions')
  const matrix = permissionsInput.parse(req.body)
  await Promise.all(Object.entries(matrix).map(([role, permissions]) =>
    RolePermission.findOneAndUpdate({ role }, { permissions, updatedBy: req.auth.sub }, { upsert: true, setDefaultsOnInsert: true })))
  await saveAudit('permissions.updated', 'RolePermission', 'matrix', {}, req.auth.sub)
  res.json(matrix)
}))

app.post('/api/admin/enrollments/bulk-decision', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Enrollment management')
  const { ids, decision, reason } = bulkDecisionInput.parse(req.body)
  const results = []
  for (const enrollmentId of ids) {
    const enrollment = await Enrollment.findById(enrollmentId)
    if (!enrollment || !['paid_approval_pending', 'rejected'].includes(enrollment.status)) { results.push({ id: enrollmentId, ok: false }); continue }
    enrollment.status = decision
    enrollment.decisionReason = reason
    enrollment.reviewedAt = new Date()
    enrollment.reviewedBy = req.auth.sub
    if (decision === 'approved') { const invitation = await provisionLearnerAccount(enrollment); await bestEffortEmail(sendPaymentReceiptEmail(enrollment, invitation?.setupUrl), 'payment_receipt email') }
    await enrollment.save()
    await saveAudit(`enrollment.${decision}`, 'Enrollment', enrollmentId, { reason, bulk: true }, req.auth.sub)
    results.push({ id: enrollmentId, ok: true })
  }
  res.json({ processed: results.filter((r) => r.ok).length, results })
}))

app.post('/api/admin/enrollments/:id/archive', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Enrollment management')
  const { archived } = z.object({ archived: z.boolean() }).parse(req.body)
  const enrollment = await Enrollment.findByIdAndUpdate(req.params.id, { archivedAt: archived ? new Date() : null }, { new: true })
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  await saveAudit(archived ? 'enrollment.archived' : 'enrollment.unarchived', 'Enrollment', req.params.id, {}, req.auth.sub)
  res.json({ id: enrollment.id, archivedAt: enrollment.archivedAt ?? null })
}))

app.get('/api/admin/audit-logs', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Audit logs')
  const query = {}
  if (req.query.entityType) query.entityType = String(req.query.entityType).slice(0, 60)
  if (req.query.action) query.action = new RegExp(String(req.query.action).slice(0, 60), 'i')
  const logs = await AuditLog.find(query).sort({ createdAt: -1 }).limit(300).populate('actorId', 'name email role').lean()
  res.json(logs.map((log) => ({
    id: log._id.toString(), action: log.action, entityType: log.entityType, entityId: log.entityId,
    metadata: log.metadata, actor: log.actorId ? { name: log.actorId.name, email: log.actorId.email, role: log.actorId.role } : null,
    createdAt: log.createdAt,
  })))
}))

app.get('/api/admin/content-assets', ...adminOnly, asyncRoute(async (_req, res) => {
  if (!dbState.ready) return requireDb(res, 'Content library')
  const assets = await ContentAsset.find().sort({ createdAt: -1 }).populate('createdBy', 'name').lean()
  res.json(assets.map((asset) => ({
    id: asset._id.toString(), title: asset.title, description: asset.description, category: asset.category,
    url: asset.url, tags: asset.tags ?? [], createdBy: asset.createdBy?.name ?? null, createdAt: asset.createdAt,
  })))
}))

app.post('/api/admin/content-assets', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Content library')
  const values = contentAssetInput.parse(req.body)
  const asset = await ContentAsset.create({ ...values, createdBy: req.auth.sub })
  await saveAudit('content_asset.created', 'ContentAsset', asset.id, { category: asset.category }, req.auth.sub)
  res.status(201).json({ id: asset.id, title: asset.title, category: asset.category })
}))

app.delete('/api/admin/content-assets/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Content library')
  const asset = await ContentAsset.findByIdAndDelete(req.params.id)
  if (!asset) return res.status(404).json({ error: 'Asset not found.' })
  await saveAudit('content_asset.deleted', 'ContentAsset', req.params.id, {}, req.auth.sub)
  res.status(204).end()
}))

app.post('/api/support/tickets', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Support tickets')
  const values = supportTicketInput.parse(req.body)
  const ticket = await SupportTicket.create({ ...values, requesterId: req.auth.sub })
  await saveAudit('support_ticket.created', 'SupportTicket', ticket.id, { category: ticket.category }, req.auth.sub)
  res.status(201).json({ id: ticket.id, status: ticket.status })
}))

app.get('/api/admin/support/tickets', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Support tickets')
  const query = {}
  if (['open', 'in_progress', 'resolved', 'closed'].includes(req.query.status)) query.status = req.query.status
  const tickets = await SupportTicket.find(query).sort({ createdAt: -1 }).limit(300).populate('requesterId', 'name email role').lean()
  res.json(tickets.map((ticket) => ({
    id: ticket._id.toString(), subject: ticket.subject, category: ticket.category, message: ticket.message,
    status: ticket.status, priority: ticket.priority, response: ticket.response,
    requester: ticket.requesterId ? { name: ticket.requesterId.name, email: ticket.requesterId.email, role: ticket.requesterId.role } : null,
    createdAt: ticket.createdAt,
  })))
}))

app.patch('/api/admin/support/tickets/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Support tickets')
  const updates = supportUpdateInput.parse(req.body)
  const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, { ...updates, handledBy: req.auth.sub }, { new: true })
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' })
  await saveAudit('support_ticket.updated', 'SupportTicket', ticket.id, updates, req.auth.sub)
  res.json({ id: ticket.id, status: ticket.status, priority: ticket.priority, response: ticket.response })
}))

app.post('/api/reports', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Reports')
  const values = reportInput.parse(req.body)
  const report = await Report.create({ ...values, reporterId: req.auth.sub, reporterRole: req.auth.role })
  await saveAudit('report.created', 'Report', report.id, { type: report.type }, req.auth.sub)
  res.status(201).json({ id: report.id, status: report.status })
}))

app.get('/api/admin/reports', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Reports')
  const query = {}
  if (['submitted', 'reviewing', 'actioned', 'dismissed'].includes(req.query.status)) query.status = req.query.status
  if (['learner', 'instructor', 'admin'].includes(req.query.role)) query.reporterRole = req.query.role
  const reports = await Report.find(query).sort({ createdAt: -1 }).limit(300).populate('reporterId', 'name email role').lean()
  res.json(reports.map((report) => ({
    id: report._id.toString(), type: report.type, title: report.title, details: report.details,
    status: report.status, reviewNote: report.reviewNote, reporterRole: report.reporterRole,
    reporter: report.reporterId ? { name: report.reporterId.name, email: report.reporterId.email, role: report.reporterId.role } : null,
    createdAt: report.createdAt,
  })))
}))

app.patch('/api/admin/reports/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Reports')
  const updates = reportUpdateInput.parse(req.body)
  const report = await Report.findByIdAndUpdate(req.params.id, { ...updates, reviewedBy: req.auth.sub }, { new: true })
  if (!report) return res.status(404).json({ error: 'Report not found.' })
  await saveAudit('report.updated', 'Report', report.id, updates, req.auth.sub)
  res.json({ id: report.id, status: report.status, reviewNote: report.reviewNote })
}))

app.get('/api/admin/analytics', ...adminOnly, asyncRoute(async (_req, res) => {
  if (!dbState.ready) return requireDb(res, 'Analytics')
  const [usersByRole, usersByStatus, enrollmentsByStatus, courseTotal, coursePublished, revenueAgg, submissionTotal, ticketOpen, reportOpen] = await Promise.all([
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    User.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Enrollment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Course.countDocuments(),
    Course.countDocuments({ isPublished: true }),
    Enrollment.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Submission.countDocuments({ submittedAt: { $ne: null } }),
    SupportTicket.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
    Report.countDocuments({ status: { $in: ['submitted', 'reviewing'] } }),
  ])
  const toMap = (rows) => Object.fromEntries(rows.map((row) => [row._id ?? 'unknown', row.count]))
  res.json({
    usersByRole: toMap(usersByRole),
    usersByStatus: toMap(usersByStatus),
    enrollmentsByStatus: toMap(enrollmentsByStatus),
    courses: { total: courseTotal, published: coursePublished },
    revenue: revenueAgg[0]?.total ?? 0,
    submissions: submissionTotal,
    openTickets: ticketOpen,
    openReports: reportOpen,
  })
}))

app.get('/api/admin/dashboard', ...adminOnly, asyncRoute(async (_req, res) => {
  if (!dbState.ready) return requireDb(res, 'Dashboard')
  const since = new Date()
  since.setMonth(since.getMonth() - 5, 1)
  since.setHours(0, 0, 0, 0)
  const monthly = (Model) => Model.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 } } },
  ])
  const [usersByRole, courseTotal, coursePublished, activeByPathway, pendingEnrollments, openReports, signupMonths, enrollmentMonths, recentUsers, recentCourses, recentActions, progressTotal, progressCompleted] = await Promise.all([
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    Course.countDocuments(),
    Course.countDocuments({ isPublished: true }),
    Enrollment.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: '$applicant.pathway', count: { $sum: 1 } } }]),
    Enrollment.countDocuments({ status: 'paid_approval_pending' }),
    Report.countDocuments({ status: { $in: ['submitted', 'reviewing'] } }),
    monthly(User),
    monthly(Enrollment),
    User.find().sort({ createdAt: -1 }).limit(5).select('name email role createdAt').lean(),
    Course.find().sort({ createdAt: -1 }).limit(5).select('title isPublished createdAt').lean(),
    AuditLog.find().sort({ createdAt: -1 }).limit(8).populate('actorId', 'name role').lean(),
    LearningProgress.countDocuments(),
    LearningProgress.countDocuments({ completedAt: { $ne: null } }),
  ])
  const toMap = (rows) => Object.fromEntries(rows.map((row) => [row._id ?? 'unknown', row.count]))
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(since.getFullYear(), since.getMonth() + index, 1)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  })
  const signupMap = toMap(signupMonths)
  const enrollmentMap = toMap(enrollmentMonths)
  res.json({
    usersByRole: toMap(usersByRole),
    courses: { total: courseTotal, published: coursePublished },
    activeEnrollmentsByPathway: toMap(activeByPathway),
    pending: { enrollments: pendingEnrollments, courses: courseTotal - coursePublished, reports: openReports },
    growth: months.map((month) => ({ month, signups: signupMap[month] ?? 0, enrollments: enrollmentMap[month] ?? 0 })),
    recentUsers,
    recentCourses,
    recentActions: recentActions.map((log) => ({ id: log._id, action: log.action, actor: log.actorId?.name ?? 'System', createdAt: log.createdAt })),
    completionRate: progressTotal ? Math.round((progressCompleted / progressTotal) * 100) : 0,
  })
}))

// Whether one learner currently satisfies one rule's condition. Each branch mirrors how that same
// fact is computed elsewhere in the app (course completion matches the auto-certificate check
// below; score comparisons match how the gradebook/quiz review express a percent) so a badge and a
// certificate never disagree about whether a course is "done".
async function badgeRuleSatisfied(rule, learnerId) {
  const { trigger, courseId } = rule
  if (trigger.type === 'course_completion') {
    const [progress, moduleCount] = await Promise.all([
      LearningProgress.findOne({ learnerId, courseId }).select('completedModuleIds').lean(),
      Module.countDocuments({ courseId }),
    ])
    return moduleCount > 0 && (progress?.completedModuleIds?.length ?? 0) >= moduleCount
  }
  if (trigger.type === 'module_milestone') {
    const progress = await LearningProgress.findOne({ learnerId, courseId }).select('completedModuleIds').lean()
    return Boolean(progress?.completedModuleIds?.some((id) => String(id) === String(trigger.moduleId)))
  }
  if (trigger.type === 'score_threshold') {
    if (trigger.targetKind === 'assignment') {
      const [submission, assignment] = await Promise.all([
        Submission.findOne({ assignmentId: trigger.targetId, learnerId }).select('grade').lean(),
        Assignment.findById(trigger.targetId).select('maxPoints').lean(),
      ])
      if (!submission || submission.grade == null || !assignment) return false
      return (submission.grade / (assignment.maxPoints || 100)) * 100 >= trigger.minPercent
    }
    // Quizzes may be attempted more than once; the most recent attempt is what "your score" means
    // everywhere else this app shows it (the Submissions review page, the learner's own history).
    const attempt = await QuizAttempt.findOne({ quizId: trigger.targetId, learnerId }).sort({ submittedAt: -1 }).select('reviewedScore percent total').lean()
    if (!attempt) return false
    const percent = attempt.reviewedScore != null && attempt.total ? (attempt.reviewedScore / attempt.total) * 100 : attempt.percent
    return percent >= trigger.minPercent
  }
  if (trigger.type === 'attendance_count') {
    const count = await Attendance.countDocuments({ courseId, learnerId, status: { $in: ['present', 'late'] } })
    return count >= trigger.minAttendance
  }
  return false
}

// Re-checks every active rule for `courseId` whose trigger could plausibly have just changed
// (`triggerTypes` narrows this — a grade save never needs to re-check attendance rules) against
// `learnerIds`, and awards any badge newly earned. Called inline from the routes that can make a
// trigger true, rather than on a schedule: the app has no background job runner, and re-checking a
// handful of rules for one or two affected learners on a write that already hits the database is
// cheap. Never throws — a badge miscalculation must not fail the grade/attendance/completion write
// that triggered it.
async function runBadgeRules(courseId, learnerIds, triggerTypes) {
  if (!dbState.ready || !courseId || !learnerIds.length) return
  try {
    const rules = await BadgeRule.find({ courseId, isActive: true, 'trigger.type': { $in: triggerTypes } }).lean()
    for (const rule of rules) {
      const eligible = rule.targetScope === 'selected'
        ? learnerIds.filter((learnerId) => rule.learnerIds?.some((allowed) => String(allowed) === String(learnerId)))
        : learnerIds
      for (const learnerId of eligible) {
        if (await StudentBadge.exists({ badgeId: rule.badgeId, learnerId })) continue // already earned — rules only ever grant once
        if (!(await badgeRuleSatisfied(rule, learnerId))) continue
        const award = await StudentBadge.create({ badgeId: rule.badgeId, learnerId, awardedByRuleId: rule._id })
        await saveAudit('badge.auto_awarded', 'StudentBadge', award.id, { badgeId: String(rule.badgeId), ruleId: String(rule._id), trigger: rule.trigger.type }, null)
        const badge = await Badge.findById(rule.badgeId).select('title').lean()
        await notifyUsers([learnerId], { title: 'New badge earned!', body: `You earned “${badge?.title ?? 'a badge'}”.`, link: '/recognition' })
      }
    }
  } catch (error) {
    console.error('Badge rule evaluation failed:', error)
  }
}

app.get('/api/badges/me', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Badges require MongoDB.' })
  const badges = await StudentBadge.find({ learnerId: req.auth.sub }).populate('badgeId', 'title description color icon').sort({ createdAt: -1 }).lean()
  res.json(badges)
}))

app.post('/api/staff/badges', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Badge management requires MongoDB.' })
  const values = badgeInput.parse(req.body)
  const badge = await Badge.create({ ...values, createdBy: req.auth.sub })
  await saveAudit('badge.created', 'Badge', badge.id, { title: badge.title }, req.auth.sub)
  res.status(201).json(badge)
}))

app.post('/api/staff/badges/:badgeId/award', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Badge awards require MongoDB.' })
  const { learnerId, note } = awardInput.parse(req.body)
  const [badge, learner] = await Promise.all([Badge.findById(req.params.badgeId), User.findOne({ _id: learnerId, role: 'learner' })])
  if (!badge || !learner) return res.status(404).json({ error: 'Badge or learner not found.' })
  const award = await StudentBadge.findOneAndUpdate({ badgeId: badge._id, learnerId: learner._id }, { awardedBy: req.auth.sub, note }, { new: true, upsert: true, setDefaultsOnInsert: true })
  await saveAudit('badge.awarded', 'StudentBadge', award.id, { badgeId: badge.id, learnerId: learner.id }, req.auth.sub)
  res.status(201).json(award)
}))

app.get('/api/staff/badges', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Badge management requires MongoDB.' })
  res.json(await Badge.find().sort({ createdAt: -1 }).lean())
}))

// A rule's trigger references a module/assignment/quiz by id only — the row it's shown on needs
// those names too, and re-fetching them per rule in the client would mean a request per row.
async function publicBadgeRule(rule) {
  const trigger = rule.trigger ?? {}
  const [module, target] = await Promise.all([
    trigger.moduleId ? Module.findById(trigger.moduleId).select('title').lean() : null,
    trigger.targetId ? (trigger.targetKind === 'quiz' ? Quiz.findById(trigger.targetId) : Assignment.findById(trigger.targetId)).select('title').lean() : null,
  ])
  return {
    id: rule._id.toString(), badgeId: String(rule.badgeId), courseId: String(rule.courseId),
    trigger: { ...trigger, moduleTitle: module?.title ?? null, targetTitle: target?.title ?? null },
    targetScope: rule.targetScope, learnerIds: (rule.learnerIds ?? []).map(String),
    isActive: rule.isActive, createdAt: rule.createdAt,
  }
}

app.get('/api/staff/badge-rules', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Badge rules require MongoDB.' })
  const filter = {}
  if (req.query.courseId) filter.courseId = req.query.courseId
  const rules = await BadgeRule.find(filter).sort({ createdAt: -1 }).lean()
  res.json(await Promise.all(rules.map(publicBadgeRule)))
}))

app.post('/api/staff/badge-rules', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Badge rules require MongoDB.' })
  const values = badgeRuleInput.parse(req.body)
  const [badge, course] = await Promise.all([Badge.findById(values.badgeId), Course.findById(values.courseId)])
  if (!badge || !course) return res.status(404).json({ error: 'Badge or course not found.' })
  const rule = await BadgeRule.create({ ...values, createdBy: req.auth.sub })
  await saveAudit('badge_rule.created', 'BadgeRule', rule.id, { badgeId: badge.id, courseId: course.id, trigger: values.trigger.type }, req.auth.sub)
  res.status(201).json(await publicBadgeRule(rule.toObject()))
}))

// Covers both "edit the condition" and "turn this rule on/off" — the same route so the client
// doesn't need two mutations for what's conceptually one action (change how this rule behaves).
app.patch('/api/staff/badge-rules/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Badge rules require MongoDB.' })
  const values = badgeRuleUpdateInput.parse(req.body)
  const rule = await BadgeRule.findById(req.params.id)
  if (!rule) return res.status(404).json({ error: 'Rule not found.' })
  if (values.trigger) rule.trigger = { ...rule.trigger.toObject?.() ?? rule.trigger, ...values.trigger }
  for (const field of ['badgeId', 'courseId', 'targetScope', 'learnerIds', 'isActive']) if (values[field] !== undefined) rule[field] = values[field]
  await rule.save()
  await saveAudit('badge_rule.updated', 'BadgeRule', rule.id, { fields: Object.keys(values) }, req.auth.sub)
  res.json(await publicBadgeRule(rule.toObject()))
}))

app.delete('/api/staff/badge-rules/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Badge rules require MongoDB.' })
  const rule = await BadgeRule.findByIdAndDelete(req.params.id)
  if (!rule) return res.status(404).json({ error: 'Rule not found.' })
  await saveAudit('badge_rule.deleted', 'BadgeRule', req.params.id, {}, req.auth.sub)
  res.status(204).end()
}))

app.post('/api/staff/certificate-templates', requireAuth, requireStaff, certificateUpload.single('layout'), asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Certificate templates require MongoDB.' })
  if (!req.file) return res.status(422).json({ error: 'Upload a PDF, PNG, or JPEG certificate layout.' })
  const values = certificateTemplateInput.parse(req.body)
  if (!mongoose.isValidObjectId(values.targetId)) return res.status(422).json({ error: 'Certificate target is invalid.' })
  const fileKey = await saveCertificateTemplate(req.file)
  const template = await CertificateTemplate.create({
    title: values.title,
    scope: values.scope,
    targetId: values.targetId,
    fileKey,
    mimeType: req.file.mimetype,
    namePosition: { x: values.nameX ?? 260, y: values.nameY ?? 140, size: values.nameSize ?? 30 },
    createdBy: req.auth.sub,
  })
  await saveAudit('certificate_template.created', 'CertificateTemplate', template.id, { scope: template.scope, targetId: values.targetId }, req.auth.sub)
  res.status(201).json(template)
}))

app.post('/api/staff/certificates/issue', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Certificate issuing requires MongoDB.' })
  const { templateId, learnerId } = certificateIssueInput.parse(req.body)
  const [template, learner] = await Promise.all([CertificateTemplate.findById(templateId), User.findOne({ _id: learnerId, role: 'learner' })])
  if (!template || !learner) return res.status(404).json({ error: 'Certificate template or learner not found.' })
  const certificate = await issueCertificate({ template, learner, issuedBy: req.auth.sub })
  res.status(201).json(certificate)
}))

app.post('/api/learning/modules/:moduleId/complete', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Module completion requires MongoDB.' })
  if (req.auth.role !== 'learner') return res.status(403).json({ error: 'Only learners can complete their own modules.' })
  const module = await Module.findById(req.params.moduleId)
  if (!module) return res.status(404).json({ error: 'Module not found.' })
  const progress = await LearningProgress.findOneAndUpdate(
    { learnerId: req.auth.sub, courseId: module.courseId },
    { $addToSet: { completedModuleIds: module._id } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )
  const learner = await User.findById(req.auth.sub)
  const moduleTemplates = await CertificateTemplate.find({ scope: 'module', targetId: module._id })
  const issued = await Promise.all(moduleTemplates.map((template) => issueCertificate({ template, learner, issuedBy: null })))
  const moduleCount = await Module.countDocuments({ courseId: module.courseId })
  if (moduleCount > 0 && progress.completedModuleIds.length >= moduleCount) {
    progress.completedAt = new Date()
    await progress.save()
    const programTemplates = await CertificateTemplate.find({ scope: 'program', targetId: module.courseId })
    issued.push(...await Promise.all(programTemplates.map((template) => issueCertificate({ template, learner, issuedBy: null }))))
  }
  await runBadgeRules(String(module.courseId), [req.auth.sub], ['course_completion', 'module_milestone'])
  await saveAudit('module.completed', 'Module', module.id, { learnerId: learner.id, certificatesIssued: issued.length }, learner.id)
  res.json({ completedModuleIds: progress.completedModuleIds, certificates: issued.map((certificate) => certificate.id) })
}))

app.get('/api/certificates/:id/download', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Certificate downloads require MongoDB.' })
  const certificate = await Certificate.findById(req.params.id)
  if (!certificate) return res.status(404).json({ error: 'Certificate not found.' })
  if (String(certificate.learnerId) !== req.auth.sub && !['instructor', 'admin'].includes(req.auth.role)) return res.status(403).json({ error: 'You cannot download this certificate.' })
  sendPrivateDownload(res, await getFile(certificate.fileKey), `Tree-Academy-Certificate-${certificate.id}.pdf`, 'application/pdf')
}))

// --- LMS content: courses, modules, lessons, assignments, quizzes, calendar, notifications ---

async function courseProgressMap(learnerId, courseIds) {
  if (!learnerId || !courseIds.length) return new Map()
  const records = await LearningProgress.find({ learnerId, courseId: { $in: courseIds } }).lean()
  return new Map(records.map((record) => [String(record.courseId), record]))
}

app.get('/api/courses', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Courses require MongoDB.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  const courses = await Course.find(isStaff ? {} : await learnerVisibleCourseFilter(req.auth.sub)).sort({ createdAt: 1 }).lean()
  const courseIds = courses.map((course) => course._id)
  const moduleCounts = await Module.aggregate([
    { $match: { courseId: { $in: courseIds }, isPublished: true } },
    { $group: { _id: '$courseId', count: { $sum: 1 } } },
  ])
  const countByCourse = new Map(moduleCounts.map((row) => [String(row._id), row.count]))
  const progressByCourse = req.auth.role === 'learner' ? await courseProgressMap(req.auth.sub, courseIds) : new Map()
  res.json(courses.map((course) => {
    const moduleCount = countByCourse.get(String(course._id)) ?? 0
    const completedCount = progressByCourse.get(String(course._id))?.completedModuleIds?.length ?? 0
    return { ...course, moduleCount, completedModuleCount: completedCount, progressPercent: moduleCount ? Math.round((completedCount / moduleCount) * 100) : 0 }
  }))
}))

app.get('/api/courses/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Courses require MongoDB.' })
  const course = await Course.findById(req.params.id).lean()
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (!isStaff) {
    if (!course.isPublished || !courseIsAvailable(course)) return res.status(404).json({ error: 'Course not found.' })
    const enrolled = await LearningProgress.exists({ learnerId: req.auth.sub, courseId: course._id })
    if (!enrolled) return res.status(404).json({ error: 'Course not found.' })
  }
  const modules = await Module.find(isStaff ? { courseId: course._id } : { courseId: course._id, isPublished: true }).sort({ position: 1 }).lean()
  const moduleIds = modules.map((module) => module._id)
  const lessons = await Lesson.find(isStaff ? { moduleId: { $in: moduleIds } } : { moduleId: { $in: moduleIds }, isPublished: true }).sort({ position: 1 }).lean()
  const lessonsByModule = new Map()
  for (const lesson of lessons) {
    const key = String(lesson.moduleId)
    if (!lessonsByModule.has(key)) lessonsByModule.set(key, [])
    lessonsByModule.get(key).push(lesson)
  }
  const progress = req.auth.role === 'learner' ? await LearningProgress.findOne({ learnerId: req.auth.sub, courseId: course._id }).lean() : null
  const completedModuleIds = new Set((progress?.completedModuleIds ?? []).map(String))

  // Assignments are nested where the learner is actually reading: under their lesson, or under the
  // phase itself as a fallback when no specific lesson was chosen at creation time.
  const assignments = await Assignment.find(isStaff ? { courseId: course._id } : { courseId: course._id, moduleId: { $in: moduleIds } }).sort({ dueAt: 1 }).lean()
  const submissionByAssignment = new Map()
  if (req.auth.role === 'learner') {
    const submissions = await Submission.find({ learnerId: req.auth.sub, assignmentId: { $in: assignments.map((assignment) => assignment._id) } }).lean()
    for (const submission of submissions) submissionByAssignment.set(String(submission.assignmentId), submission)
  }
  const shapeAssignment = (assignment) => ({
    id: assignment._id, _id: assignment._id, position: assignment.position ?? 0,
    title: assignment.title, instructions: assignment.instructions ?? null,
    instructionsUrl: assignment.instructionsUrl ?? null, dueAt: assignment.dueAt ?? null, maxPoints: assignment.maxPoints,
    mySubmission: submissionByAssignment.get(String(assignment._id)) ?? null,
  })
  const assignmentsByLesson = new Map()
  const assignmentsByModule = new Map()
  for (const assignment of assignments) {
    if (assignment.lessonId) {
      const key = String(assignment.lessonId)
      if (!assignmentsByLesson.has(key)) assignmentsByLesson.set(key, [])
      assignmentsByLesson.get(key).push(assignment)
    } else {
      const key = String(assignment.moduleId)
      if (!assignmentsByModule.has(key)) assignmentsByModule.set(key, [])
      assignmentsByModule.get(key).push(assignment)
    }
  }

  // Quizzes scoped to a phase (moduleId set) are surfaced inline in the builder's per-phase
  // Sections list, alongside that phase's lessons and module-level assignments — staff only, so
  // learner-facing course reads are unaffected.
  const quizzesByModule = new Map()
  if (isStaff) {
    const quizzes = await Quiz.find({ moduleId: { $in: moduleIds } }, { 'questions.answerIndex': 0, 'questions.explanation': 0, 'questions.acceptableAnswers': 0, 'questions.pairs': 0 }).lean()
    for (const quiz of quizzes) {
      const key = String(quiz.moduleId)
      if (!quizzesByModule.has(key)) quizzesByModule.set(key, [])
      quizzesByModule.get(key).push({ ...quiz, questionCount: quiz.questions?.length ?? 0 })
    }
  }

  res.json({
    ...course,
    modules: modules.map((module) => ({
      ...module,
      completed: completedModuleIds.has(String(module._id)),
      assignments: (assignmentsByModule.get(String(module._id)) ?? []).map(shapeAssignment),
      quizzes: quizzesByModule.get(String(module._id)) ?? [],
      lessons: (lessonsByModule.get(String(module._id)) ?? []).map((lesson) => ({
        ...lesson, assignments: (assignmentsByLesson.get(String(lesson._id)) ?? []).map(shapeAssignment),
      })),
    })),
  })
}))

app.get('/api/courses/:id/categories', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Courses require MongoDB.' })
  const course = await Course.findById(req.params.id).lean()
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (!isStaff) {
    if (!course.isPublished || !courseIsAvailable(course) || !(await LearningProgress.exists({ learnerId: req.auth.sub, courseId: course._id }))) return res.status(404).json({ error: 'Course not found.' })
  }
  const categories = await Category.find({ courseId: course._id, ...(isStaff ? {} : { status: 'published' }) }).sort({ position: 1 }).lean()
  res.json(categories)
}))

app.get('/api/courses/:id/categories/:categoryId', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Courses require MongoDB.' })
  const course = await Course.findById(req.params.id).lean()
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (!isStaff) {
    if (!course.isPublished || !courseIsAvailable(course) || !(await LearningProgress.exists({ learnerId: req.auth.sub, courseId: course._id }))) return res.status(404).json({ error: 'Course not found.' })
  }
  const category = await Category.findOne({ _id: req.params.categoryId, courseId: course._id, ...(isStaff ? {} : { status: 'published' }) }).lean()
  if (!category) return res.status(404).json({ error: 'Category not found.' })
  const headers = await CategoryHeader.find({ categoryId: category._id }).sort({ position: 1 }).lean()
  const headerIds = headers.map((item) => item._id)
  const modules = await LearningModule.find({ headerId: { $in: headerIds }, ...(isStaff ? {} : { status: 'published' }) }).sort({ position: 1 }).lean()
  const modulesByHeader = new Map(headerIds.map((id) => [String(id), []]))
  modules.forEach((item) => modulesByHeader.get(String(item.headerId))?.push(item))
  const headersWithModules = headers.map((item) => ({ ...item, modules: modulesByHeader.get(String(item._id)) ?? [] })).filter((item) => isStaff || item.modules.length > 0)
  res.json({ ...category, headers: headersWithModules })
}))

app.post('/api/staff/courses', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Courses require MongoDB.' })
  const values = courseInput.parse(req.body)
  const course = await Course.create(values)
  await saveAudit('course.created', 'Course', course.id, { title: course.title }, req.auth.sub)
  res.status(201).json(course)
}))

app.patch('/api/staff/courses/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Courses require MongoDB.' })
  const values = courseUpdateInput.parse(req.body)
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  // Instructors can't publish until an admin has signed off; admins bypass the gate.
  if (values.isPublished && req.auth.role !== 'admin' && course.approvalStatus !== 'approved') {
    return res.status(409).json({ error: 'This course needs admin approval before it can be published. Submit it for review first.' })
  }
  if (values.slug && values.slug !== course.slug) {
    if (RESERVED_COURSE_SLUGS.includes(course.slug)) return res.status(409).json({ error: 'This slug is fixed — pricing and checkout are linked to it.' })
    if (RESERVED_COURSE_SLUGS.includes(values.slug)) return res.status(409).json({ error: 'That slug is reserved for the enrollment pathway courses.' })
    if (await Course.findOne({ slug: values.slug, _id: { $ne: course._id } })) return res.status(409).json({ error: 'That slug is already used by another course.' })
  }
  Object.assign(course, values)
  await course.save()
  await saveAudit('course.updated', 'Course', course.id, {}, req.auth.sub)
  res.json(course)
}))

app.post('/api/staff/courses/:id/banner', requireAuth, requireStaff, bannerUpload.single('banner'), asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Banner uploads require MongoDB.' })
  if (!req.file) return res.status(400).json({ error: 'Choose a JPG, PNG, or WEBP image under 4MB.' })
  const bannerUrl = await saveBannerUpload(req.file)
  const course = await Course.findByIdAndUpdate(req.params.id, { bannerUrl, bannerPreset: null }, { new: true })
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  await saveAudit('course.banner_updated', 'Course', course.id, {}, req.auth.sub)
  res.json({ bannerUrl, course })
}))

app.post('/api/staff/courses/:id/agreement-template', requireAuth, requireStaff, agreementTemplateUpload.single('template'), asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Agreement templates require MongoDB.' })
  if (!req.file) return res.status(400).json({ error: 'Choose a PDF under 8MB.' })
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const fields = await extractAgreementFields(req.file.buffer)
  if (!fields.length) return res.status(422).json({ error: 'That PDF has no fillable fields. Add AcroForm text/checkbox fields to it first.' })
  const fileKey = await saveAgreementTemplate(req.file)
  course.agreementTemplate = { fileKey, originalName: req.file.originalname, fields, uploadedAt: new Date() }
  await course.save()
  await saveAudit('course.agreement_template_uploaded', 'Course', course.id, { fieldCount: fields.length }, req.auth.sub)
  res.json(course)
}))

app.delete('/api/staff/courses/:id/agreement-template', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Agreement templates require MongoDB.' })
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  course.agreementTemplate = undefined
  await course.save()
  await saveAudit('course.agreement_template_removed', 'Course', course.id, {}, req.auth.sub)
  res.json(course)
}))

// Summary only — applicant name/email/signedAt, never the signed PDF's storage key (same rule as
// GET /api/staff/enrollments). Staff read the file itself via the /document route below.
app.get('/api/staff/courses/:id/agreement-enrollments', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Course applicants require MongoDB.' })
  const rows = await CourseEnrollment.find({ courseId: req.params.id }).sort({ createdAt: -1 }).lean()
  res.json(rows.map((row) => ({ _id: String(row._id), applicant: row.applicant, signedAt: row.document?.signedAt ?? null, createdAt: row.createdAt })))
}))

app.get('/api/staff/course-enrollments/:id/document', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Course applicants require MongoDB.' })
  const row = await CourseEnrollment.findById(req.params.id)
  if (!row || !row.document?.pdfKey) return res.status(404).json({ error: 'Signed document not found.' })
  await saveAudit('course_enrollment.document_viewed', 'CourseEnrollment', req.params.id, {}, req.auth.sub)
  const safeName = (row.applicant?.name ?? 'applicant').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')
  sendPrivateDownload(res, await getFile(row.document.pdfKey), `${safeName}-agreement.pdf`, 'application/pdf')
}))

// --- Instructor catalogue builder: course -> category -> header -> typed learning module ---
async function editableCourse(req, res, courseId) {
  const course = await Course.findById(courseId)
  if (!course) { res.status(404).json({ error: 'Course not found.' }); return null }
  if (req.auth.role !== 'admin' && !course.assignedInstructorIds.some((id) => String(id) === req.auth.sub)) {
    res.status(403).json({ error: 'You are not assigned to this course.' }); return null
  }
  return course
}

app.get('/api/staff/builder/courses', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Course builder requires MongoDB.' })
  const filter = req.auth.role === 'admin' ? {} : { assignedInstructorIds: req.auth.sub }
  res.json(await Course.find(filter).select('title slug description bannerPreset bannerUrl isPublished').sort({ title: 1 }).lean())
}))

app.get('/api/staff/builder/courses/:courseId/categories', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Course builder requires MongoDB.' })
  if (!(await editableCourse(req, res, req.params.courseId))) return
  const categories = await Category.find({ courseId: req.params.courseId }).sort({ position: 1 }).lean()
  const ids = categories.map((item) => item._id)
  const headers = await CategoryHeader.find({ categoryId: { $in: ids } }).sort({ position: 1 }).lean()
  const headerIds = headers.map((item) => item._id)
  const modules = await LearningModule.find({ headerId: { $in: headerIds } }).sort({ position: 1 }).lean()
  const modulesByHeader = new Map(headerIds.map((id) => [String(id), []]))
  modules.forEach((item) => modulesByHeader.get(String(item.headerId))?.push(item))
  const headersByCategory = new Map(ids.map((id) => [String(id), []]))
  headers.forEach((item) => headersByCategory.get(String(item.categoryId))?.push({ ...item, modules: modulesByHeader.get(String(item._id)) ?? [] }))
  res.json(categories.map((item) => ({ ...item, headers: headersByCategory.get(String(item._id)) ?? [] })))
}))

app.post('/api/staff/builder/courses/:courseId/categories', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Course builder requires MongoDB.' })
  if (!(await editableCourse(req, res, req.params.courseId))) return
  res.status(201).json(await Category.create({ ...categoryInput.parse(req.body), courseId: req.params.courseId }))
}))
app.patch('/api/staff/builder/categories/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const category = await Category.findById(req.params.id); if (!category || !(await editableCourse(req, res, category.courseId))) return
  res.json(await Category.findByIdAndUpdate(category._id, categoryUpdateInput.parse(req.body), { new: true }))
}))
app.delete('/api/staff/builder/categories/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const category = await Category.findById(req.params.id); if (!category || !(await editableCourse(req, res, category.courseId))) return
  const headers = await CategoryHeader.find({ categoryId: category._id }).select('_id')
  await LearningModule.deleteMany({ headerId: { $in: headers.map((item) => item._id) } }); await CategoryHeader.deleteMany({ categoryId: category._id }); await category.deleteOne()
  res.status(204).end()
}))
app.post('/api/staff/builder/categories/:categoryId/headers', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const category = await Category.findById(req.params.categoryId); if (!category || !(await editableCourse(req, res, category.courseId))) return
  res.status(201).json(await CategoryHeader.create({ ...categoryHeaderInput.parse(req.body), categoryId: category._id }))
}))
app.patch('/api/staff/builder/headers/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const header = await CategoryHeader.findById(req.params.id); const category = header && await Category.findById(header.categoryId); if (!header || !category || !(await editableCourse(req, res, category.courseId))) return
  res.json(await CategoryHeader.findByIdAndUpdate(header._id, categoryHeaderInput.partial().parse(req.body), { new: true }))
}))
app.post('/api/staff/builder/headers/:headerId/modules', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const header = await CategoryHeader.findById(req.params.headerId); const category = header && await Category.findById(header.categoryId); if (!header || !category || !(await editableCourse(req, res, category.courseId))) return
  res.status(201).json(await LearningModule.create({ ...learningModuleInput.parse(req.body), headerId: header._id }))
}))
app.patch('/api/staff/builder/modules/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const module = await LearningModule.findById(req.params.id); const header = module && await CategoryHeader.findById(module.headerId); const category = header && await Category.findById(header.categoryId); if (!module || !category || !(await editableCourse(req, res, category.courseId))) return
  res.json(await LearningModule.findByIdAndUpdate(module._id, learningModuleUpdateInput.parse(req.body), { new: true }))
}))

app.post('/api/staff/courses/:id/submit-review', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Courses require MongoDB.' })
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  if (course.approvalStatus === 'approved') return res.status(409).json({ error: 'This course is already approved.' })
  if (course.approvalStatus === 'pending_review') return res.status(409).json({ error: 'This course is already awaiting review.' })
  course.approvalStatus = 'pending_review'
  course.reviewNote = undefined
  await course.save()
  await saveAudit('course.submitted_for_review', 'Course', course.id, {}, req.auth.sub)
  res.json(course)
}))

app.post('/api/admin/courses/:id/review', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Catalog management')
  const { decision, note } = courseReviewInput.parse(req.body)
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  course.approvalStatus = decision
  course.reviewNote = note || undefined
  if (decision === 'rejected') course.isPublished = false
  await course.save()
  await saveAudit(`course.review_${decision}`, 'Course', course.id, { note: note || null }, req.auth.sub)
  res.json(course)
}))

app.post('/api/staff/courses/:id/modules', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Modules require MongoDB.' })
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const module = await Module.create({ ...moduleInput.parse(req.body), courseId: course._id })
  await saveAudit('module.created', 'Module', module.id, { courseId: course.id }, req.auth.sub)
  res.status(201).json(module)
}))

app.patch('/api/staff/modules/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Modules require MongoDB.' })
  const module = await Module.findByIdAndUpdate(req.params.id, moduleUpdateInput.parse(req.body), { new: true })
  if (!module) return res.status(404).json({ error: 'Module not found.' })
  await saveAudit('module.updated', 'Module', module.id, {}, req.auth.sub)
  res.json(module)
}))

app.delete('/api/staff/modules/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Modules require MongoDB.' })
  const module = await Module.findByIdAndDelete(req.params.id)
  if (!module) return res.status(404).json({ error: 'Module not found.' })
  await Lesson.deleteMany({ moduleId: module._id })
  const assignments = await Assignment.find({ moduleId: module._id }).select('_id')
  await Submission.deleteMany({ assignmentId: { $in: assignments.map((item) => item._id) } })
  await Assignment.deleteMany({ moduleId: module._id })
  await LearningProgress.updateMany({}, { $pull: { completedModuleIds: module._id } })
  await saveAudit('module.deleted', 'Module', module.id, {}, req.auth.sub)
  res.status(204).end()
}))

app.post('/api/staff/modules/:id/lessons', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Lessons require MongoDB.' })
  const module = await Module.findById(req.params.id)
  if (!module) return res.status(404).json({ error: 'Module not found.' })
  const lesson = await Lesson.create({ ...lessonInput.parse(req.body), moduleId: module._id })
  await saveAudit('lesson.created', 'Lesson', lesson.id, { moduleId: module.id }, req.auth.sub)
  res.status(201).json(lesson)
}))

app.patch('/api/staff/lessons/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Lessons require MongoDB.' })
  const lesson = await Lesson.findByIdAndUpdate(req.params.id, lessonUpdateInput.parse(req.body), { new: true })
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' })
  await saveAudit('lesson.updated', 'Lesson', lesson.id, {}, req.auth.sub)
  res.json(lesson)
}))

app.delete('/api/staff/lessons/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Lessons require MongoDB.' })
  const lesson = await Lesson.findByIdAndDelete(req.params.id)
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' })
  await Assignment.updateMany({ lessonId: lesson._id }, { $set: { lessonId: null } })
  await saveAudit('lesson.deleted', 'Lesson', lesson.id, {}, req.auth.sub)
  res.status(204).end()
}))

app.get('/api/assignments', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Assignments require MongoDB.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  const courses = await Course.find(isStaff ? {} : await learnerVisibleCourseFilter(req.auth.sub)).select('_id title').lean()
  const courseTitleById = new Map(courses.map((course) => [String(course._id), course.title]))
  const assignments = await Assignment.find({ courseId: { $in: courses.map((course) => course._id) } }).sort({ dueAt: 1 }).lean()
  let submissionByAssignment = new Map()
  if (req.auth.role === 'learner') {
    const submissions = await Submission.find({ learnerId: req.auth.sub, assignmentId: { $in: assignments.map((assignment) => assignment._id) } }).lean()
    submissionByAssignment = new Map(submissions.map((submission) => [String(submission.assignmentId), submission]))
  }
  res.json(assignments.map((assignment) => ({ ...assignment, courseTitle: courseTitleById.get(String(assignment.courseId)) ?? 'Course', mySubmission: submissionByAssignment.get(String(assignment._id)) ?? null })))
}))

app.get('/api/assignments/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Assignments require MongoDB.' })
  const assignment = await Assignment.findById(req.params.id).lean()
  if (!assignment) return res.status(404).json({ error: 'Assignment not found.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (!isStaff) {
    const enrolled = await LearningProgress.exists({ learnerId: req.auth.sub, courseId: assignment.courseId })
    if (!enrolled) return res.status(404).json({ error: 'Assignment not found.' })
  }
  const [course, module, lesson, submission] = await Promise.all([
    Course.findById(assignment.courseId).select('title').lean(),
    Module.findById(assignment.moduleId).select('title phaseNumber').lean(),
    assignment.lessonId ? Lesson.findById(assignment.lessonId).select('title').lean() : null,
    req.auth.role === 'learner' ? Submission.findOne({ assignmentId: assignment._id, learnerId: req.auth.sub }).lean() : null,
  ])
  res.json({
    ...assignment, courseTitle: course?.title ?? 'Course', moduleTitle: module?.title ?? null,
    phaseNumber: module?.phaseNumber ?? null, lessonTitle: lesson?.title ?? null,
    mySubmission: submission,
  })
}))

app.post('/api/staff/courses/:id/assignments', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Assignments require MongoDB.' })
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const values = assignmentInput.parse(req.body)
  const module = await Module.findOne({ _id: values.moduleId, courseId: course._id })
  if (!module) return res.status(404).json({ error: 'Phase not found in this course.' })
  if (values.lessonId && !(await Lesson.exists({ _id: values.lessonId, moduleId: module._id }))) return res.status(404).json({ error: 'Lesson not found in this phase.' })
  const assignment = await Assignment.create({ ...values, courseId: course._id })
  await saveAudit('assignment.created', 'Assignment', assignment.id, { courseId: course.id }, req.auth.sub)
  res.status(201).json(assignment)
}))

app.patch('/api/staff/assignments/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Assignments require MongoDB.' })
  const assignment = await Assignment.findByIdAndUpdate(req.params.id, assignmentUpdateInput.parse(req.body), { new: true })
  if (!assignment) return res.status(404).json({ error: 'Assignment not found.' })
  await saveAudit('assignment.updated', 'Assignment', assignment.id, {}, req.auth.sub)
  res.json(assignment)
}))

app.delete('/api/staff/assignments/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Assignments require MongoDB.' })
  const assignment = await Assignment.findByIdAndDelete(req.params.id)
  if (!assignment) return res.status(404).json({ error: 'Assignment not found.' })
  await Submission.deleteMany({ assignmentId: assignment._id })
  await saveAudit('assignment.deleted', 'Assignment', assignment.id, {}, req.auth.sub)
  res.status(204).end()
}))

app.post('/api/assignments/:id/submissions', requireAuth, submissionUpload.single('attachment'), asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Submissions require MongoDB.' })
  if (req.auth.role !== 'learner') return res.status(403).json({ error: 'Only learners can submit assignments.' })
  const assignment = await Assignment.findById(req.params.id)
  if (!assignment) return res.status(404).json({ error: 'Assignment not found.' })
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : ''
  const existing = await Submission.findOne({ assignmentId: assignment._id, learnerId: req.auth.sub })
  const submissionType = assignment.submissionType ?? 'both'
  if (submissionType === 'text' && req.file) return res.status(400).json({ error: 'This assignment only accepts a written response, not a file.' })
  if (submissionType === 'file' && !req.file && !existing?.attachmentKey) return res.status(400).json({ error: 'This assignment requires a file upload.' })
  if (!body && !req.file && !existing?.attachmentKey) return res.status(400).json({ error: 'Add a response or a file before submitting.' })
  const update = { body: body || undefined, submittedAt: new Date() }
  if (req.file) {
    update.attachmentKey = await saveSubmissionAttachment(req.file)
    update.attachmentName = req.file.originalname
  }
  const submission = await Submission.findOneAndUpdate(
    { assignmentId: assignment._id, learnerId: req.auth.sub },
    { $set: update, $unset: { grade: '', feedback: '' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )
  await saveAudit('submission.submitted', 'Submission', submission.id, { assignmentId: assignment.id }, req.auth.sub)
  const [learner, staff] = await Promise.all([
    User.findById(req.auth.sub).select('name').lean(),
    User.find({ role: { $in: ['instructor', 'admin'] }, status: 'active' }).select('_id').lean(),
  ])
  await notifyUsers(staff.map((member) => member._id), {
    title: `New submission: ${assignment.title}`,
    body: `${learner?.name ?? 'A learner'} submitted "${assignment.title}".`,
    link: '/gradebook',
  })
  res.status(201).json(submission)
}))

app.get('/api/submissions/:id/attachment', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Submissions require MongoDB.' })
  const submission = await Submission.findById(req.params.id)
  if (!submission || !submission.attachmentKey) return res.status(404).json({ error: 'No attachment found.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (!isStaff && String(submission.learnerId) !== req.auth.sub) return res.status(403).json({ error: 'You cannot download this attachment.' })
  sendPrivateDownload(res, await getFile(submission.attachmentKey), submission.attachmentName || `submission-${submission.id}`)
}))

app.get('/api/staff/assignments/:id/submissions', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Submissions require MongoDB.' })
  const submissions = await Submission.find({ assignmentId: req.params.id }).populate('learnerId', 'name email').sort({ submittedAt: -1 }).lean()
  res.json(submissions)
}))

// Everything the standalone review page needs for one assignment submission. Without this the page
// could only be reached by first loading the whole course gradebook, which made it undeep-linkable.
app.get('/api/staff/submissions/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Submissions require MongoDB.' })
  const submission = await Submission.findById(req.params.id).populate('learnerId', 'name email avatarUrl').lean()
  if (!submission) return res.status(404).json({ error: 'Submission not found.' })
  const assignment = await Assignment.findById(submission.assignmentId).select('title maxPoints dueAt instructions courseId').lean()
  res.json({
    id: String(submission._id), kind: 'assignment',
    title: assignment?.title ?? 'Assignment', instructions: assignment?.instructions ?? '',
    courseId: assignment?.courseId ? String(assignment.courseId) : null,
    maxPoints: assignment?.maxPoints ?? 100, dueAt: assignment?.dueAt ?? null,
    learner: submission.learnerId ? { id: String(submission.learnerId._id), name: submission.learnerId.name, email: submission.learnerId.email } : null,
    submittedAt: submission.submittedAt ?? submission.createdAt,
    body: submission.body ?? '', grade: submission.grade ?? null, feedback: submission.feedback ?? '',
    // The key itself never leaves the server — the browser fetches bytes through the attachment
    // route, which authorizes the caller first.
    attachmentName: submission.attachmentName ?? null, hasAttachment: Boolean(submission.attachmentKey),
  })
}))

app.post('/api/staff/submissions/:id/grade', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Grading requires MongoDB.' })
  const submission = await Submission.findByIdAndUpdate(req.params.id, gradeInput.parse(req.body), { new: true })
  if (!submission) return res.status(404).json({ error: 'Submission not found.' })
  await saveAudit('submission.graded', 'Submission', submission.id, {}, req.auth.sub)
  const assignment = await Assignment.findById(submission.assignmentId).select('title courseId').lean()
  await notifyUsers([submission.learnerId], {
    title: `Graded: ${assignment?.title ?? 'Assignment'}`,
    body: `You scored ${submission.grade}${submission.feedback ? ` — ${submission.feedback}` : ''}`,
    link: `/assignments/${submission.assignmentId}`,
  })
  if (assignment?.courseId) await runBadgeRules(String(assignment.courseId), [String(submission.learnerId)], ['score_threshold'])
  res.json(submission)
}))

// Threaded comments on something a learner handed in — a lighter-weight back-and-forth than the
// single overwritable `feedback` field, open to the author and any staff member. Assignments and
// quiz attempts share the implementation; only the lookup and the notification wording differ.
const publicComment = (comment, author) => ({
  id: comment._id?.toString() ?? comment.id, body: comment.body, authorRole: comment.authorRole, createdAt: comment.createdAt,
  author: author ? { name: author.name, avatarUrl: author.avatarUrl ?? null } : null,
})

// Resolves the commentable and checks the caller may see it, so neither route repeats the rule
// that a learner reaches only their own work while staff reach anyone's.
async function loadCommentTarget(kind, id, auth) {
  const isStaff = ['instructor', 'admin'].includes(auth.role)
  const record = kind === 'submission'
    ? await Submission.findById(id).select('learnerId assignmentId')
    : await QuizAttempt.findById(id).select('learnerId quizId')
  if (!record) return { error: { status: 404, message: kind === 'submission' ? 'Submission not found.' : 'Quiz attempt not found.' } }
  if (!isStaff && String(record.learnerId) !== auth.sub) return { error: { status: 403, message: 'You cannot view this.' } }
  const title = kind === 'submission'
    ? (await Assignment.findById(record.assignmentId).select('title').lean())?.title
    : (await Quiz.findById(record.quizId).select('title').lean())?.title
  return { record, isStaff, filter: kind === 'submission' ? { submissionId: record._id } : { quizAttemptId: record._id }, title, learnerLink: kind === 'submission' ? `/assignments/${record.assignmentId}` : '/catalog' }
}

const listComments = (kind) => asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Comments require MongoDB.' })
  const target = await loadCommentTarget(kind, req.params.id, req.auth)
  if (target.error) return res.status(target.error.status).json({ error: target.error.message })
  const comments = await SubmissionComment.find(target.filter).sort({ createdAt: 1 }).populate('authorId', 'name avatarUrl').lean()
  res.json(comments.map((comment) => publicComment(comment, comment.authorId)))
})

const createComment = (kind) => asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Comments require MongoDB.' })
  const target = await loadCommentTarget(kind, req.params.id, req.auth)
  if (target.error) return res.status(target.error.status).json({ error: target.error.message })
  const values = submissionCommentInput.parse(req.body)
  const comment = await SubmissionComment.create({ ...target.filter, authorId: req.auth.sub, authorRole: req.auth.role, body: values.body })
  await saveAudit('submission.commented', kind === 'submission' ? 'Submission' : 'QuizAttempt', String(target.record._id), {}, req.auth.sub)
  const author = await User.findById(req.auth.sub).select('name avatarUrl').lean()
  if (target.isStaff) {
    await notifyUsers([target.record.learnerId], { title: `New comment on: ${target.title ?? 'your work'}`, body: `${author?.name ?? 'Your instructor'} left a comment.`, link: target.learnerLink })
  } else {
    const staff = await User.find({ role: { $in: ['instructor', 'admin'] }, status: 'active' }).select('_id').lean()
    await notifyUsers(staff.map((member) => member._id), { title: `New comment on: ${target.title ?? 'a submission'}`, body: `${author?.name ?? 'A learner'} left a comment.`, link: '/submissions' })
  }
  res.status(201).json(publicComment(comment, author))
})

app.get('/api/submissions/:id/comments', requireAuth, listComments('submission'))
app.post('/api/submissions/:id/comments', requireAuth, createComment('submission'))
app.get('/api/quiz-attempts/:id/comments', requireAuth, listComments('quiz_attempt'))
app.post('/api/quiz-attempts/:id/comments', requireAuth, createComment('quiz_attempt'))

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

app.get('/api/quizzes', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Quizzes require MongoDB.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  const courses = await Course.find(isStaff ? {} : await learnerVisibleCourseFilter(req.auth.sub)).select('_id title').lean()
  const courseTitleById = new Map(courses.map((course) => [String(course._id), course.title]))
  const courseIds = courses.map((course) => course._id)
  const quizFilter = isStaff ? { courseId: { $in: courseIds } } : { courseId: { $in: courseIds }, isPublished: true }
  const quizzes = await Quiz.find(quizFilter, { 'questions.answerIndex': 0, 'questions.explanation': 0, 'questions.acceptableAnswers': 0, 'questions.pairs': 0 }).sort({ createdAt: 1 }).lean()
  res.json(quizzes.map((quiz) => ({ ...quiz, courseTitle: courseTitleById.get(String(quiz.courseId)) ?? 'Course', questionCount: quiz.questions?.length ?? 0 })))
}))

// Strips the answer key from a question before it reaches a learner. Matching questions need
// special handling: the left/right pairing itself IS the answer, so instead of hiding `pairs`
// outright (which would leave nothing to render), the left prompts and a shuffled list of right
// options are sent as decoupled arrays.
function sanitizeQuestionForLearner(question) {
  const base = { type: question.type ?? 'multiple_choice', prompt: question.prompt }
  if (question.type === 'matching') {
    const pairs = question.pairs ?? []
    const rights = pairs.map((pair) => pair.right)
    for (let i = rights.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1));[rights[i], rights[j]] = [rights[j], rights[i]] }
    return { ...base, lefts: pairs.map((pair) => pair.left), rights }
  }
  if (question.type === 'enumeration') return { ...base, minAnswers: question.minAnswers }
  if (question.type === 'fill_blank' || question.type === 'essay') return base
  return { ...base, choices: question.choices }
}

app.get('/api/quizzes/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Quizzes require MongoDB.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  const quiz = await Quiz.findById(req.params.id).lean()
  if (!quiz || (!quiz.isPublished && !isStaff)) return res.status(404).json({ error: 'Quiz not found.' })
  if (isStaff) return res.json(quiz)
  res.json({ ...quiz, questions: quiz.questions.map(sanitizeQuestionForLearner) })
}))

app.post('/api/staff/courses/:id/quizzes', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Quizzes require MongoDB.' })
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const values = quizInput.parse(req.body)
  if (values.moduleId && !(await Module.exists({ _id: values.moduleId, courseId: course._id }))) return res.status(404).json({ error: 'Phase not found in this course.' })
  const quiz = await Quiz.create({ ...values, courseId: course._id })
  await saveAudit('quiz.created', 'Quiz', quiz.id, { courseId: course.id }, req.auth.sub)
  res.status(201).json(quiz)
}))

app.patch('/api/staff/quizzes/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Quizzes require MongoDB.' })
  const values = quizUpdateInput.parse(req.body)
  if (values.moduleId) {
    const existing = await Quiz.findById(req.params.id).select('courseId').lean()
    if (!existing) return res.status(404).json({ error: 'Quiz not found.' })
    if (!(await Module.exists({ _id: values.moduleId, courseId: existing.courseId }))) return res.status(404).json({ error: 'Phase not found in this course.' })
  }
  const quiz = await Quiz.findByIdAndUpdate(req.params.id, values, { new: true })
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' })
  await saveAudit('quiz.updated', 'Quiz', quiz.id, {}, req.auth.sub)
  res.json(quiz)
}))

app.delete('/api/staff/quizzes/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Quizzes require MongoDB.' })
  const quiz = await Quiz.findByIdAndDelete(req.params.id)
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' })
  await saveAudit('quiz.deleted', 'Quiz', quiz.id, {}, req.auth.sub)
  res.status(204).end()
}))

// Auto-grades one question against a learner's answer; the answer's shape depends on the
// question's type (see quizQuestionInput above). `essay` is never auto-graded — it returns
// correct: null so it's excluded from the score and shown back for self-review instead.
function gradeQuizQuestion(question, answer) {
  const normalize = (value) => String(value ?? '').trim().toLowerCase()
  switch (question.type ?? 'multiple_choice') {
    case 'fill_blank':
      return { correct: (question.acceptableAnswers ?? []).some((accepted) => normalize(accepted) === normalize(answer)), response: answer ?? '' }
    case 'enumeration': {
      const accepted = new Set((question.acceptableAnswers ?? []).map(normalize))
      const given = Array.isArray(answer) ? answer : []
      const matchedCount = new Set(given.map(normalize).filter((value) => accepted.has(value))).size
      return { correct: matchedCount >= (question.minAnswers ?? (question.acceptableAnswers ?? []).length), matchedCount, response: given }
    }
    case 'matching': {
      const given = answer && typeof answer === 'object' ? answer : {}
      return { correct: (question.pairs ?? []).every((pair, index) => given[index] === pair.right), response: given }
    }
    case 'essay':
      return { correct: null, response: typeof answer === 'string' ? answer : '' }
    default:
      return { correct: answer === question.answerIndex, selectedIndex: answer ?? null }
  }
}

app.post('/api/quizzes/:id/attempt', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Quiz attempts require MongoDB.' })
  if (req.auth.role !== 'learner') return res.status(403).json({ error: 'Only learners can attempt quizzes.' })
  const quiz = await Quiz.findById(req.params.id).lean()
  if (!quiz || !quiz.isPublished) return res.status(404).json({ error: 'Quiz not found.' })
  const { answers } = quizAttemptInput.parse(req.body)
  const results = quiz.questions.map((question, index) => ({
    type: question.type ?? 'multiple_choice',
    prompt: question.prompt,
    choices: question.choices,
    answerIndex: question.answerIndex,
    acceptableAnswers: question.acceptableAnswers,
    pairs: question.pairs,
    minAnswers: question.minAnswers,
    explanation: question.explanation,
    ...gradeQuizQuestion(question, answers[index]),
  }))
  const gradable = results.filter((result) => result.correct !== null)
  const score = gradable.filter((result) => result.correct).length
  const percent = gradable.length ? Math.round((score / gradable.length) * 100) : 0
  await saveAudit('quiz.attempted', 'Quiz', quiz._id.toString(), { score, total: gradable.length }, req.auth.sub)
  // Recorded so instructors can review it later. Best-effort: a learner who has just finished a
  // quiz should still get their result even if the write fails, so this never rejects the request.
  const attempt = await QuizAttempt.create({
    quizId: quiz._id, courseId: quiz.courseId, learnerId: req.auth.sub,
    answers, results, score, total: gradable.length, percent, submittedAt: new Date(),
  }).catch((error) => { console.error('Failed to record quiz attempt:', error); return null })
  if (attempt) await runBadgeRules(String(quiz.courseId), [req.auth.sub], ['score_threshold'])
  res.json({ id: attempt?.id ?? null, score, total: gradable.length, percent, results })
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
