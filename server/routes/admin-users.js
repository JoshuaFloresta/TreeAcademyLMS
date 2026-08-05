import express from 'express'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { Course, LearningProgress, Presence, RefreshToken, StudentBadge, Submission, User } from '../models.js'
import { requireAdmin, requireAuth } from '../security.js'
import { dbState } from '../state.js'
import { asyncRoute, requireDb } from '../lib/http.js'
import { saveAudit } from '../lib/audit.js'
import { bestEffortEmail, issueAccountSetupUrl, sendCredentialsEmail } from '../lib/accounts.js'
import { issueSession, sessionUser } from '../lib/session.js'
import { avatarUpload, saveAvatarUpload } from '../lib/uploads.js'
import { usernameField } from '../lib/zod-helpers.js'

export const router = express.Router()

const adminOnly = [requireAuth, requireAdmin]

const adminUserCreateInput = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  username: usernameField.optional(),
  role: z.enum(['learner', 'instructor', 'admin']).optional(),
  courseIds: z.array(z.string().trim().min(1)).max(100).optional(),
})
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

const adminUserView = (user) => ({
  id: user._id?.toString() ?? user.id, name: user.name, email: user.email, username: user.username ?? null,
  role: user.role, status: user.status, avatarUrl: user.avatarUrl ?? null, mustChangePassword: user.mustChangePassword,
  lastSeenAt: user.lastSeenAt, createdAt: user.createdAt,
})

router.get('/api/admin/users', ...adminOnly, asyncRoute(async (req, res) => {
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

router.post('/api/admin/users', ...adminOnly, asyncRoute(async (req, res) => {
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

router.post('/api/admin/users/import', ...adminOnly, asyncRoute(async (req, res) => {
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

router.patch('/api/admin/users/:id', ...adminOnly, asyncRoute(async (req, res) => {
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

router.post('/api/admin/users/:id/avatar', ...adminOnly, avatarUpload.single('avatar'), asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  if (!req.file) return res.status(400).json({ error: 'Choose a JPG, PNG, or WEBP image under 3MB.' })
  const avatarUrl = await saveAvatarUpload(req.file)
  const user = await User.findByIdAndUpdate(req.params.id, { avatarUrl }, { new: true })
  if (!user) return res.status(404).json({ error: 'User not found.' })
  await saveAudit('user.avatar_updated', 'User', user.id, {}, req.auth.sub)
  res.json(adminUserView(user))
}))

router.delete('/api/admin/users/:id', ...adminOnly, asyncRoute(async (req, res) => {
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

router.post('/api/admin/users/bulk-action', ...adminOnly, asyncRoute(async (req, res) => {
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

router.post('/api/admin/users/bulk-enroll', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  const { ids, courseId } = bulkEnrollInput.parse(req.body)
  if (!mongoose.isValidObjectId(courseId) || !(await Course.findById(courseId))) return res.status(404).json({ error: 'Course not found.' })
  const learners = await User.find({ _id: { $in: ids }, role: 'learner' }).select('_id').lean()
  await Promise.all(learners.map((learner) => LearningProgress.findOneAndUpdate(
    { learnerId: learner._id, courseId }, { $setOnInsert: { completedModuleIds: [] } }, { upsert: true, setDefaultsOnInsert: true })))
  await saveAudit('user.bulk_enrolled', 'Course', courseId, { count: learners.length }, req.auth.sub)
  res.json({ enrolled: learners.length })
}))

router.post('/api/admin/users/:id/password', ...adminOnly, asyncRoute(async (req, res) => {
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

router.get('/api/admin/users/:id/courses', ...adminOnly, asyncRoute(async (req, res) => {
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

router.post('/api/admin/users/:id/courses', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  const { courseId } = z.object({ courseId: z.string().trim().min(1) }).parse(req.body)
  if (!mongoose.isValidObjectId(courseId) || !(await Course.findById(courseId))) return res.status(404).json({ error: 'Course not found.' })
  await LearningProgress.findOneAndUpdate({ learnerId: req.params.id, courseId }, { $setOnInsert: { completedModuleIds: [] } }, { upsert: true, setDefaultsOnInsert: true })
  await saveAudit('user.enrolled', 'Course', courseId, { learnerId: req.params.id }, req.auth.sub)
  res.status(201).json({ enrolled: true })
}))

router.delete('/api/admin/users/:id/courses/:courseId', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  await LearningProgress.deleteOne({ learnerId: req.params.id, courseId: req.params.courseId })
  await saveAudit('user.unenrolled', 'Course', req.params.courseId, { learnerId: req.params.id }, req.auth.sub)
  res.status(204).end()
}))

router.get('/api/admin/users/:id/teaching-courses', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return requireDb(res, 'User management')
  const instructor = await User.findById(req.params.id).select('role')
  if (!instructor) return res.status(404).json({ error: 'User not found.' })
  if (instructor.role !== 'instructor') return res.status(409).json({ error: 'Only instructors can be assigned teaching courses.' })
  const courses = await Course.find().select('title slug assignedInstructorIds').sort({ title: 1 }).lean()
  res.json(courses.map((course) => ({ id: String(course._id), title: course.title, slug: course.slug, assigned: (course.assignedInstructorIds ?? []).some((id) => String(id) === req.params.id) })))
}))

router.put('/api/admin/users/:id/teaching-courses', ...adminOnly, asyncRoute(async (req, res) => {
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

router.post('/api/admin/users/:id/impersonate', ...adminOnly, asyncRoute(async (req, res) => {
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
