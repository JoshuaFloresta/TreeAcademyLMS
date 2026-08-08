import express from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import {
  Assignment, AuditLog, BlogPost, Course, ContentAsset, Enrollment, EmailTemplate, LearningProgress, Lesson,
  Module, Quiz, Report, RolePermission, Submission, SupportTicket, User, Webinar, WebinarRegistration,
} from '../models.js'
import { requireAdmin, requireAuth } from '../security.js'
import { emailTemplateDefaults, sampleVarsFor, sendTemplatedEmail } from '../email.js'
import { dbState } from '../state.js'
import { asyncRoute, requireDb } from '../lib/http.js'
import { saveAudit } from '../lib/audit.js'
import { bestEffortEmail } from '../lib/accounts.js'
import { blogCoverUpload, saveBlogCoverUpload } from '../lib/uploads.js'
import { provisionLearnerAccount, sendPaymentReceiptEmail } from '../lib/enrollment-shared.js'

export const router = express.Router()

const adminOnly = [requireAuth, requireAdmin]

const adminCourseInput = z.object({
  isPublished: z.boolean().optional(),
  archived: z.boolean().optional(),
  availableFrom: z.coerce.date().nullable().optional(),
  availableUntil: z.coerce.date().nullable().optional(),
  showEnrollmentCount: z.boolean().optional(),
})
const webinarInput = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional(),
  startsAt: z.coerce.date(),
  registrationDeadline: z.coerce.date().nullable().optional(),
  capacity: z.coerce.number().int().min(1).nullable().optional(),
  isPublished: z.boolean().optional(),
})
const webinarUpdateInput = webinarInput.partial()
const slugify = (value) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200)
const blogInput = z.object({
  title: z.string().trim().min(2).max(200),
  // Optional — auto-derived from the title when omitted, same as course creation elsewhere.
  slug: z.string().trim().min(2).max(200).optional(),
  excerpt: z.string().trim().max(300).optional(),
  body: z.string().trim().min(2).max(20000),
  coverImageUrl: z.string().trim().max(500).nullable().optional(),
  category: z.enum(['program_updates', 'exam_tips', 'real_estate_news', 'company_news']).optional(),
  status: z.enum(['draft', 'published']).optional(),
})
const blogUpdateInput = blogInput.partial()
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

router.get('/api/admin/courses', ...adminOnly, asyncRoute(async (_req, res) => {
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

router.patch('/api/admin/courses/:id', ...adminOnly, asyncRoute(async (req, res) => {
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

router.delete('/api/admin/courses/:id', ...adminOnly, asyncRoute(async (req, res) => {
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

router.get('/api/admin/webinars', ...adminOnly, asyncRoute(async (_req, res) => {
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

router.post('/api/admin/webinars', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Webinar management')
  const webinar = await Webinar.create({ ...webinarInput.parse(req.body), createdBy: req.auth.sub })
  await saveAudit('webinar.created', 'Webinar', webinar.id, {}, req.auth.sub)
  res.status(201).json(webinar)
}))

router.patch('/api/admin/webinars/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Webinar management')
  const webinar = await Webinar.findByIdAndUpdate(req.params.id, webinarUpdateInput.parse(req.body), { new: true })
  if (!webinar) return res.status(404).json({ error: 'Webinar not found.' })
  await saveAudit('webinar.updated', 'Webinar', webinar.id, {}, req.auth.sub)
  res.json(webinar)
}))

router.delete('/api/admin/webinars/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Webinar management')
  const webinar = await Webinar.findByIdAndDelete(req.params.id)
  if (!webinar) return res.status(404).json({ error: 'Webinar not found.' })
  await WebinarRegistration.deleteMany({ webinarId: webinar._id })
  await saveAudit('webinar.deleted', 'Webinar', webinar.id, {}, req.auth.sub)
  res.status(204).end()
}))

router.get('/api/admin/webinars/:id/registrations', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Webinar management')
  const registrations = await WebinarRegistration.find({ webinarId: req.params.id }).sort({ createdAt: -1 }).lean()
  res.json(registrations)
}))

// --- Blog (staff-authored posts) ------------------------------------------------------------
// Public reads live in routes/misc.js (GET /api/public/blog, /api/public/blog/:slug) — this file
// only has the staff-facing write/list side, same split as Webinars above.

router.get('/api/admin/blog', ...adminOnly, asyncRoute(async (_req, res) => {
  if (!dbState.ready) return requireDb(res, 'Blog')
  const posts = await BlogPost.find().sort({ createdAt: -1 }).populate('authorId', 'name').lean()
  res.json(posts.map((post) => ({ ...post, id: String(post._id), authorName: post.authorId?.name ?? '—', authorId: undefined })))
}))

router.post('/api/admin/blog', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Blog')
  const values = blogInput.parse(req.body)
  const slug = slugify(values.slug || values.title)
  if (!slug) return res.status(422).json({ error: 'Enter a title or slug that can produce a valid URL.' })
  if (await BlogPost.findOne({ slug })) return res.status(409).json({ error: 'That slug is already used by another post.' })
  const post = await BlogPost.create({
    ...values, slug, authorId: req.auth.sub,
    publishedAt: values.status === 'published' ? new Date() : undefined,
  })
  await saveAudit('blog.created', 'BlogPost', post.id, { title: post.title, status: post.status }, req.auth.sub)
  res.status(201).json(post)
}))

router.patch('/api/admin/blog/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Blog')
  const values = blogUpdateInput.parse(req.body)
  const post = await BlogPost.findById(req.params.id)
  if (!post) return res.status(404).json({ error: 'Post not found.' })
  if ('slug' in values) {
    const slug = slugify(values.slug || post.title)
    if (!slug) return res.status(422).json({ error: 'Enter a slug that can produce a valid URL.' })
    if (slug !== post.slug && await BlogPost.findOne({ slug, _id: { $ne: post._id } })) return res.status(409).json({ error: 'That slug is already used by another post.' })
    values.slug = slug
  }
  // First publish stamps the date; re-publishing (or editing while already published) never
  // bumps it, so a typo fix doesn't bounce a post back to the top of a date-sorted feed.
  if (values.status === 'published' && post.status !== 'published') values.publishedAt = new Date()
  Object.assign(post, values)
  await post.save()
  await saveAudit('blog.updated', 'BlogPost', post.id, { fields: Object.keys(values) }, req.auth.sub)
  res.json(post)
}))

router.delete('/api/admin/blog/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Blog')
  const post = await BlogPost.findByIdAndDelete(req.params.id)
  if (!post) return res.status(404).json({ error: 'Post not found.' })
  await saveAudit('blog.deleted', 'BlogPost', req.params.id, { title: post.title }, req.auth.sub)
  res.status(204).end()
}))

router.post('/api/admin/blog/cover', ...adminOnly, blogCoverUpload.single('cover'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a JPG, PNG, or WEBP image under 4MB.' })
  const coverImageUrl = await saveBlogCoverUpload(req.file)
  res.json({ coverImageUrl })
}))

router.get('/api/admin/email-templates', ...adminOnly, asyncRoute(async (_req, res) => {
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

router.patch('/api/admin/email-templates/:key', ...adminOnly, asyncRoute(async (req, res) => {
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

router.post('/api/admin/email-templates/:key/test', ...adminOnly, testEmailLimiter, asyncRoute(async (req, res) => {
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

router.get('/api/admin/permissions', ...adminOnly, asyncRoute(async (_req, res) => {
  if (!dbState.ready) return res.json(DEFAULT_PERMISSIONS)
  res.json(await loadPermissions())
}))

router.put('/api/admin/permissions', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Role permissions')
  const matrix = permissionsInput.parse(req.body)
  await Promise.all(Object.entries(matrix).map(([role, permissions]) =>
    RolePermission.findOneAndUpdate({ role }, { permissions, updatedBy: req.auth.sub }, { upsert: true, setDefaultsOnInsert: true })))
  await saveAudit('permissions.updated', 'RolePermission', 'matrix', {}, req.auth.sub)
  res.json(matrix)
}))

router.post('/api/admin/enrollments/bulk-decision', ...adminOnly, asyncRoute(async (req, res) => {
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

router.post('/api/admin/enrollments/:id/archive', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Enrollment management')
  const { archived } = z.object({ archived: z.boolean() }).parse(req.body)
  const enrollment = await Enrollment.findByIdAndUpdate(req.params.id, { archivedAt: archived ? new Date() : null }, { new: true })
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  await saveAudit(archived ? 'enrollment.archived' : 'enrollment.unarchived', 'Enrollment', req.params.id, {}, req.auth.sub)
  res.json({ id: enrollment.id, archivedAt: enrollment.archivedAt ?? null })
}))

router.get('/api/admin/audit-logs', ...adminOnly, asyncRoute(async (req, res) => {
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

router.get('/api/admin/content-assets', ...adminOnly, asyncRoute(async (_req, res) => {
  if (!dbState.ready) return requireDb(res, 'Content library')
  const assets = await ContentAsset.find().sort({ createdAt: -1 }).populate('createdBy', 'name').lean()
  res.json(assets.map((asset) => ({
    id: asset._id.toString(), title: asset.title, description: asset.description, category: asset.category,
    url: asset.url, tags: asset.tags ?? [], createdBy: asset.createdBy?.name ?? null, createdAt: asset.createdAt,
  })))
}))

router.post('/api/admin/content-assets', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Content library')
  const values = contentAssetInput.parse(req.body)
  const asset = await ContentAsset.create({ ...values, createdBy: req.auth.sub })
  await saveAudit('content_asset.created', 'ContentAsset', asset.id, { category: asset.category }, req.auth.sub)
  res.status(201).json({ id: asset.id, title: asset.title, category: asset.category })
}))

router.delete('/api/admin/content-assets/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Content library')
  const asset = await ContentAsset.findByIdAndDelete(req.params.id)
  if (!asset) return res.status(404).json({ error: 'Asset not found.' })
  await saveAudit('content_asset.deleted', 'ContentAsset', req.params.id, {}, req.auth.sub)
  res.status(204).end()
}))

router.post('/api/support/tickets', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Support tickets')
  const values = supportTicketInput.parse(req.body)
  const ticket = await SupportTicket.create({ ...values, requesterId: req.auth.sub })
  await saveAudit('support_ticket.created', 'SupportTicket', ticket.id, { category: ticket.category }, req.auth.sub)
  res.status(201).json({ id: ticket.id, status: ticket.status })
}))

router.get('/api/admin/support/tickets', ...adminOnly, asyncRoute(async (req, res) => {
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

router.patch('/api/admin/support/tickets/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Support tickets')
  const updates = supportUpdateInput.parse(req.body)
  const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, { ...updates, handledBy: req.auth.sub }, { new: true })
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' })
  await saveAudit('support_ticket.updated', 'SupportTicket', ticket.id, updates, req.auth.sub)
  res.json({ id: ticket.id, status: ticket.status, priority: ticket.priority, response: ticket.response })
}))

router.post('/api/reports', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Reports')
  const values = reportInput.parse(req.body)
  const report = await Report.create({ ...values, reporterId: req.auth.sub, reporterRole: req.auth.role })
  await saveAudit('report.created', 'Report', report.id, { type: report.type }, req.auth.sub)
  res.status(201).json({ id: report.id, status: report.status })
}))

router.get('/api/admin/reports', ...adminOnly, asyncRoute(async (req, res) => {
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

router.patch('/api/admin/reports/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'Reports')
  const updates = reportUpdateInput.parse(req.body)
  const report = await Report.findByIdAndUpdate(req.params.id, { ...updates, reviewedBy: req.auth.sub }, { new: true })
  if (!report) return res.status(404).json({ error: 'Report not found.' })
  await saveAudit('report.updated', 'Report', report.id, updates, req.auth.sub)
  res.json({ id: report.id, status: report.status, reviewNote: report.reviewNote })
}))

router.get('/api/admin/analytics', ...adminOnly, asyncRoute(async (_req, res) => {
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

router.get('/api/admin/dashboard', ...adminOnly, asyncRoute(async (_req, res) => {
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
