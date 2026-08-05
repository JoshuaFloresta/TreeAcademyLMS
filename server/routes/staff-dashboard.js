import express from 'express'
import { z } from 'zod'
import { Assignment, Course, Enrollment, LearningProgress, Module, Quiz, QuizAttempt, Submission, User } from '../models.js'
import { requireAuth, requireStaff } from '../security.js'
import { dbState } from '../state.js'
import { asyncRoute } from '../lib/http.js'
import { saveAudit } from '../lib/audit.js'
import { notifyUsers } from '../lib/notify.js'
import { runBadgeRules } from '../lib/badge-rules.js'

export const router = express.Router()

// An instructor reviewing an attempt may override the automatic score (after marking an essay,
// say) and/or leave written feedback — both optional, since either alone is a valid review.
const quizReviewInput = z.object({ reviewedScore: z.coerce.number().min(0).nullable().optional(), feedback: z.string().trim().max(2000).optional() })

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

router.get('/api/staff/overview', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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

router.get('/api/staff/grading-queue', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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

router.get('/api/staff/learners', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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

router.get('/api/staff/courses/:id/gradebook', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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
router.get('/api/staff/courses/:id/submissions', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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
router.get('/api/staff/quiz-attempts/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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

router.post('/api/staff/quiz-attempts/:id/review', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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

router.get('/api/staff/courses/:id/analytics', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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
