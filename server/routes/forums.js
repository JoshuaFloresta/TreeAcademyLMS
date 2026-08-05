import express from 'express'
import { z } from 'zod'
import { Announcement, Course, ForumPost, ForumReaction, ForumThread, LearningProgress, Notification } from '../models.js'
import { requireAuth, requireStaff } from '../security.js'
import { dbState } from '../state.js'
import { asyncRoute } from '../lib/http.js'
import { forumImageUpload, saveForumImageUpload } from '../lib/uploads.js'
import { saveAudit } from '../lib/audit.js'
import { visibleCourses } from '../lib/course-visibility.js'

export const router = express.Router()

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

// Class communication — course announcements (one-way) and discussion forums (two-way).
router.get('/api/announcements', requireAuth, asyncRoute(async (req, res) => {
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

router.post('/api/staff/courses/:id/announcements', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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

router.delete('/api/staff/announcements/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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

router.post('/api/forums/images', requireAuth, forumImageUpload.single('image'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Attach a PNG, JPEG, or WEBP image.' })
  const imageUrl = await saveForumImageUpload(req.file)
  res.status(201).json({ imageUrl })
}))

router.get('/api/forums/threads', requireAuth, asyncRoute(async (req, res) => {
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

router.post('/api/forums/threads', requireAuth, asyncRoute(async (req, res) => {
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

router.get('/api/forums/threads/:id', requireAuth, asyncRoute(async (req, res) => {
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

router.post('/api/forums/threads/:id/reactions', requireAuth, asyncRoute(async (req, res) => {
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

router.post('/api/forums/threads/:id/posts', requireAuth, asyncRoute(async (req, res) => {
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

router.patch('/api/staff/forums/threads/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Forums require MongoDB.' })
  const thread = await ForumThread.findByIdAndUpdate(req.params.id, forumModerateInput.parse(req.body), { new: true })
  if (!thread) return res.status(404).json({ error: 'Thread not found.' })
  await saveAudit('forum_thread.moderated', 'ForumThread', thread.id, { isPinned: thread.isPinned, isLocked: thread.isLocked }, req.auth.sub)
  res.json(thread)
}))

router.delete('/api/staff/forums/threads/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Forums require MongoDB.' })
  const thread = await ForumThread.findByIdAndDelete(req.params.id)
  if (!thread) return res.status(404).json({ error: 'Thread not found.' })
  await Promise.all([ForumPost.deleteMany({ threadId: thread._id }), ForumReaction.deleteMany({ threadId: thread._id })])
  await saveAudit('forum_thread.deleted', 'ForumThread', thread.id, {}, req.auth.sub)
  res.status(204).end()
}))

router.patch('/api/forums/posts/:id', requireAuth, asyncRoute(async (req, res) => {
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

router.delete('/api/forums/posts/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Forums require MongoDB.' })
  const post = await ForumPost.findById(req.params.id)
  if (!post) return res.status(404).json({ error: 'Reply not found.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (!isStaff && String(post.authorId) !== req.auth.sub) return res.status(403).json({ error: 'You can only delete your own reply.' })
  await post.deleteOne()
  await saveAudit('forum_post.deleted', 'ForumPost', post.id, { threadId: String(post.threadId) }, req.auth.sub)
  res.status(204).end()
}))
