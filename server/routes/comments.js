import express from 'express'
import { z } from 'zod'
import { Assignment, Quiz, QuizAttempt, Submission, SubmissionComment, User } from '../models.js'
import { requireAuth } from '../security.js'
import { dbState } from '../state.js'
import { asyncRoute } from '../lib/http.js'
import { saveAudit } from '../lib/audit.js'
import { notifyUsers } from '../lib/notify.js'

export const router = express.Router()

const submissionCommentInput = z.object({ body: z.string().trim().min(1).max(4000) })

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

router.get('/api/submissions/:id/comments', requireAuth, listComments('submission'))
router.post('/api/submissions/:id/comments', requireAuth, createComment('submission'))
router.get('/api/quiz-attempts/:id/comments', requireAuth, listComments('quiz_attempt'))
router.post('/api/quiz-attempts/:id/comments', requireAuth, createComment('quiz_attempt'))
