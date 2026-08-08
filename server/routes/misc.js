import express from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { integrations } from '../config.js'
import { catalog } from '../catalog.js'
import { Announcement, BlogPost, Course, LearningProgress, NewsletterSubscriber, Notification, User, Webinar, WebinarRegistration } from '../models.js'
import { requireAuth, requireStaff } from '../security.js'
import { sendTemplatedEmail } from '../email.js'
import { dbState, memory } from '../state.js'
import { asyncRoute } from '../lib/http.js'
import { saveAudit } from '../lib/audit.js'
import { learnerVisibleCourseFilter } from '../lib/course-visibility.js'
import { RESERVED_COURSE_SLUGS } from '../lib/enrollment-shared.js'
import { fetchRealEstateNews } from '../lib/real-estate-news.js'

export const router = express.Router()

const newsletterInput = z.object({ email: z.string().email().max(254) })
const webinarRegisterInput = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(254) })
const notificationBroadcastInput = z.object({
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().max(2000).optional(),
  link: z.string().trim().max(300).optional(),
  audience: z.enum(['all_learners', 'all_staff', 'everyone']).optional(),
  recipientIds: z.array(z.string().trim().min(1)).optional(),
})

router.get('/api/health', (_req, res) => res.json({ status: 'ok', database: dbState.ready ? 'connected' : 'demo-memory', integrations }))
router.get('/api/catalog', (_req, res) => res.json(catalog))

// Live pathway stats for the existing "Three pathways" landing section — seed data maps one
// Course per pathway via slug `${pathwayId}-review` (see seed-content.js), so that's the join key.
// Folds enrollment counts + seasonal availability into the pathway cards already on the page,
// rather than a separate catalog section.
router.get('/api/public/pathway-stats', asyncRoute(async (_req, res) => {
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

router.get('/api/public/webinars', asyncRoute(async (_req, res) => {
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

router.post('/api/public/webinars/:id/register', asyncRoute(async (req, res) => {
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

// --- Blog (public reads) ----------------------------------------------------------------------
// Staff-facing CRUD lives in routes/admin-catalog.js — this is the read-only public side, same
// split as webinars above. `select` deliberately excludes nothing here: a published post has no
// field an anonymous reader shouldn't see (unlike, say, enrollment records).
const blogListItem = (post) => ({
  id: String(post._id), title: post.title, slug: post.slug, excerpt: post.excerpt ?? '',
  coverImageUrl: post.coverImageUrl ?? null, category: post.category, publishedAt: post.publishedAt,
})

router.get('/api/public/blog', asyncRoute(async (_req, res) => {
  if (!dbState.ready) return res.json([])
  const posts = await BlogPost.find({ status: 'published' }).sort({ publishedAt: -1 }).limit(50).lean()
  res.json(posts.map(blogListItem))
}))

router.get('/api/public/blog/:slug', asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(404).json({ error: 'Post not found.' })
  const post = await BlogPost.findOne({ slug: req.params.slug, status: 'published' }).populate('authorId', 'name').lean()
  if (!post) return res.status(404).json({ error: 'Post not found.' })
  res.json({ ...blogListItem(post), body: post.body, authorName: post.authorId?.name ?? 'Tree Academy' })
}))

// Per-IP, not per-account — this route is public/unauthenticated like the rest of the blog. The
// shared in-memory cache in lib/real-estate-news.js is what actually protects the upstream GNews
// quota (one cached fetch serves every visitor for an hour, regardless of traffic); this is just
// defense-in-depth against someone hammering our own endpoint pointlessly.
const newsFeedLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
})

// Best-effort — a provider hiccup on the very first (uncached) request degrades to an empty list
// rather than a 500, since this section is decorative next to the staff-authored blog above it.
router.get('/api/public/real-estate-news', newsFeedLimiter, asyncRoute(async (_req, res) => {
  try {
    res.json(await fetchRealEstateNews())
  } catch {
    res.json({ configured: true, articles: [] })
  }
}))

router.post('/api/newsletter', asyncRoute(async (req, res) => {
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

router.get('/api/search', requireAuth, asyncRoute(async (req, res) => {
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

router.get('/api/notifications/me', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Notifications require MongoDB.' })
  const notifications = await Notification.find({ recipientId: req.auth.sub }).sort({ createdAt: -1 }).limit(100).lean()
  res.json(notifications)
}))

router.post('/api/notifications/:id/read', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Notifications require MongoDB.' })
  const notification = await Notification.findOneAndUpdate({ _id: req.params.id, recipientId: req.auth.sub }, { readAt: new Date() }, { new: true })
  if (!notification) return res.status(404).json({ error: 'Notification not found.' })
  res.json(notification)
}))

router.post('/api/notifications/read-all', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Notifications require MongoDB.' })
  await Notification.updateMany({ recipientId: req.auth.sub, readAt: { $exists: false } }, { readAt: new Date() })
  res.json({ ok: true })
}))

router.post('/api/staff/notifications', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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
