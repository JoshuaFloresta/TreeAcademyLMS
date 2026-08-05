import express from 'express'
import { z } from 'zod'
import { Assignment, Course, Lesson, LearningProgress, Module, Submission, User } from '../models.js'
import { requireAuth, requireStaff } from '../security.js'
import { saveSubmissionAttachment } from '../certificates.js'
import { getFile } from '../storage.js'
import { dbState } from '../state.js'
import { asyncRoute, sendPrivateDownload } from '../lib/http.js'
import { submissionUpload } from '../lib/uploads.js'
import { saveAudit } from '../lib/audit.js'
import { notifyUsers } from '../lib/notify.js'
import { learnerVisibleCourseFilter } from '../lib/course-visibility.js'
import { runBadgeRules } from '../lib/badge-rules.js'

export const router = express.Router()

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

router.get('/api/assignments', requireAuth, asyncRoute(async (req, res) => {
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

router.get('/api/assignments/:id', requireAuth, asyncRoute(async (req, res) => {
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

router.post('/api/staff/courses/:id/assignments', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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

router.patch('/api/staff/assignments/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Assignments require MongoDB.' })
  const assignment = await Assignment.findByIdAndUpdate(req.params.id, assignmentUpdateInput.parse(req.body), { new: true })
  if (!assignment) return res.status(404).json({ error: 'Assignment not found.' })
  await saveAudit('assignment.updated', 'Assignment', assignment.id, {}, req.auth.sub)
  res.json(assignment)
}))

router.delete('/api/staff/assignments/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Assignments require MongoDB.' })
  const assignment = await Assignment.findByIdAndDelete(req.params.id)
  if (!assignment) return res.status(404).json({ error: 'Assignment not found.' })
  await Submission.deleteMany({ assignmentId: assignment._id })
  await saveAudit('assignment.deleted', 'Assignment', assignment.id, {}, req.auth.sub)
  res.status(204).end()
}))

router.post('/api/assignments/:id/submissions', requireAuth, submissionUpload.single('attachment'), asyncRoute(async (req, res) => {
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

router.get('/api/submissions/:id/attachment', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Submissions require MongoDB.' })
  const submission = await Submission.findById(req.params.id)
  if (!submission || !submission.attachmentKey) return res.status(404).json({ error: 'No attachment found.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (!isStaff && String(submission.learnerId) !== req.auth.sub) return res.status(403).json({ error: 'You cannot download this attachment.' })
  sendPrivateDownload(res, await getFile(submission.attachmentKey), submission.attachmentName || `submission-${submission.id}`)
}))

router.get('/api/staff/assignments/:id/submissions', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Submissions require MongoDB.' })
  const submissions = await Submission.find({ assignmentId: req.params.id }).populate('learnerId', 'name email').sort({ submittedAt: -1 }).lean()
  res.json(submissions)
}))

// Everything the standalone review page needs for one assignment submission. Without this the page
// could only be reached by first loading the whole course gradebook, which made it undeep-linkable.
router.get('/api/staff/submissions/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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

router.post('/api/staff/submissions/:id/grade', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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
