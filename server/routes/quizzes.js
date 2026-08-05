import express from 'express'
import { z } from 'zod'
import { Course, Module, Quiz, QuizAttempt } from '../models.js'
import { requireAuth, requireStaff } from '../security.js'
import { dbState } from '../state.js'
import { asyncRoute } from '../lib/http.js'
import { saveAudit } from '../lib/audit.js'
import { learnerVisibleCourseFilter } from '../lib/course-visibility.js'
import { runBadgeRules } from '../lib/badge-rules.js'

export const router = express.Router()

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

router.get('/api/quizzes', requireAuth, asyncRoute(async (req, res) => {
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

router.get('/api/quizzes/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Quizzes require MongoDB.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  const quiz = await Quiz.findById(req.params.id).lean()
  if (!quiz || (!quiz.isPublished && !isStaff)) return res.status(404).json({ error: 'Quiz not found.' })
  if (isStaff) return res.json(quiz)
  res.json({ ...quiz, questions: quiz.questions.map(sanitizeQuestionForLearner) })
}))

router.post('/api/staff/courses/:id/quizzes', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Quizzes require MongoDB.' })
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const values = quizInput.parse(req.body)
  if (values.moduleId && !(await Module.exists({ _id: values.moduleId, courseId: course._id }))) return res.status(404).json({ error: 'Phase not found in this course.' })
  const quiz = await Quiz.create({ ...values, courseId: course._id })
  await saveAudit('quiz.created', 'Quiz', quiz.id, { courseId: course.id }, req.auth.sub)
  res.status(201).json(quiz)
}))

router.patch('/api/staff/quizzes/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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

router.delete('/api/staff/quizzes/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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

router.post('/api/quizzes/:id/attempt', requireAuth, asyncRoute(async (req, res) => {
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
