import express from 'express'
import { z } from 'zod'
import {
  Assignment, Category, CategoryHeader, Course, CourseEnrollment, LearningModule, LearningProgress,
  Lesson, Module, Quiz, Submission,
} from '../models.js'
import { requireAdmin, requireAuth, requireStaff } from '../security.js'
import { extractAgreementFields, saveAgreementTemplate } from '../enrollment-documents.js'
import { getFile } from '../storage.js'
import { dbState } from '../state.js'
import { asyncRoute, sendPrivateDownload } from '../lib/http.js'
import { agreementTemplateUpload, bannerUpload, saveBannerUpload } from '../lib/uploads.js'
import { saveAudit } from '../lib/audit.js'
import { courseIsAvailable, learnerVisibleCourseFilter } from '../lib/course-visibility.js'
import { RESERVED_COURSE_SLUGS } from '../lib/enrollment-shared.js'

export const router = express.Router()

const adminOnly = [requireAuth, requireAdmin]

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
const categoryInput = z.object({ title: z.string().trim().min(2).max(160), description: z.string().trim().max(2000).optional(), bannerPreset: z.string().trim().max(60).optional(), bannerUrl: z.string().trim().url().max(1000).optional(), position: z.coerce.number().int().min(0) })
const categoryUpdateInput = categoryInput.partial().extend({ status: z.enum(['draft', 'published', 'archived']).optional() })
const categoryHeaderInput = z.object({ title: z.string().trim().min(2).max(160), position: z.coerce.number().int().min(0) })
const learningModuleInput = z.object({ type: z.enum(['file', 'quiz', 'assignment']), title: z.string().trim().min(2).max(160), instructions: z.string().trim().max(5000).optional(), resourceUrl: z.string().trim().url().max(1000).optional(), position: z.coerce.number().int().min(0), quiz: z.object({ questions: z.array(z.object({ prompt: z.string().trim().min(2).max(1000), choices: z.array(z.string().trim().min(1).max(300)).min(2).max(6), answerIndex: z.coerce.number().int().min(0) })).max(50).optional(), passingScore: z.coerce.number().min(0).max(100).optional() }).optional(), assignment: z.object({ maxPoints: z.coerce.number().min(1).max(1000).optional(), rubric: z.string().trim().max(5000).optional(), feedbackTemplate: z.string().trim().max(2000).optional() }).optional() })
const learningModuleUpdateInput = learningModuleInput.partial().extend({ status: z.enum(['draft', 'published', 'archived']).optional() })
const courseReviewInput = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(2000).optional() })

async function courseProgressMap(learnerId, courseIds) {
  if (!learnerId || !courseIds.length) return new Map()
  const records = await LearningProgress.find({ learnerId, courseId: { $in: courseIds } }).lean()
  return new Map(records.map((record) => [String(record.courseId), record]))
}

router.get('/api/courses', requireAuth, asyncRoute(async (req, res) => {
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

router.get('/api/courses/:id', requireAuth, asyncRoute(async (req, res) => {
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

router.get('/api/courses/:id/categories', requireAuth, asyncRoute(async (req, res) => {
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

router.get('/api/courses/:id/categories/:categoryId', requireAuth, asyncRoute(async (req, res) => {
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

router.post('/api/staff/courses', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Courses require MongoDB.' })
  const values = courseInput.parse(req.body)
  const course = await Course.create(values)
  await saveAudit('course.created', 'Course', course.id, { title: course.title }, req.auth.sub)
  res.status(201).json(course)
}))

router.patch('/api/staff/courses/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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

router.post('/api/staff/courses/:id/banner', requireAuth, requireStaff, bannerUpload.single('banner'), asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Banner uploads require MongoDB.' })
  if (!req.file) return res.status(400).json({ error: 'Choose a JPG, PNG, or WEBP image under 4MB.' })
  const bannerUrl = await saveBannerUpload(req.file)
  const course = await Course.findByIdAndUpdate(req.params.id, { bannerUrl, bannerPreset: null }, { new: true })
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  await saveAudit('course.banner_updated', 'Course', course.id, {}, req.auth.sub)
  res.json({ bannerUrl, course })
}))

router.post('/api/staff/courses/:id/agreement-template', requireAuth, requireStaff, agreementTemplateUpload.single('template'), asyncRoute(async (req, res) => {
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

router.delete('/api/staff/courses/:id/agreement-template', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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
router.get('/api/staff/courses/:id/agreement-enrollments', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Course applicants require MongoDB.' })
  const rows = await CourseEnrollment.find({ courseId: req.params.id }).sort({ createdAt: -1 }).lean()
  res.json(rows.map((row) => ({ _id: String(row._id), applicant: row.applicant, signedAt: row.document?.signedAt ?? null, createdAt: row.createdAt })))
}))

router.get('/api/staff/course-enrollments/:id/document', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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

router.get('/api/staff/builder/courses', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Course builder requires MongoDB.' })
  const filter = req.auth.role === 'admin' ? {} : { assignedInstructorIds: req.auth.sub }
  res.json(await Course.find(filter).select('title slug description bannerPreset bannerUrl isPublished').sort({ title: 1 }).lean())
}))

router.get('/api/staff/builder/courses/:courseId/categories', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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

router.post('/api/staff/builder/courses/:courseId/categories', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Course builder requires MongoDB.' })
  if (!(await editableCourse(req, res, req.params.courseId))) return
  res.status(201).json(await Category.create({ ...categoryInput.parse(req.body), courseId: req.params.courseId }))
}))
router.patch('/api/staff/builder/categories/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const category = await Category.findById(req.params.id); if (!category || !(await editableCourse(req, res, category.courseId))) return
  res.json(await Category.findByIdAndUpdate(category._id, categoryUpdateInput.parse(req.body), { new: true }))
}))
router.delete('/api/staff/builder/categories/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const category = await Category.findById(req.params.id); if (!category || !(await editableCourse(req, res, category.courseId))) return
  const headers = await CategoryHeader.find({ categoryId: category._id }).select('_id')
  await LearningModule.deleteMany({ headerId: { $in: headers.map((item) => item._id) } }); await CategoryHeader.deleteMany({ categoryId: category._id }); await category.deleteOne()
  res.status(204).end()
}))
router.post('/api/staff/builder/categories/:categoryId/headers', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const category = await Category.findById(req.params.categoryId); if (!category || !(await editableCourse(req, res, category.courseId))) return
  res.status(201).json(await CategoryHeader.create({ ...categoryHeaderInput.parse(req.body), categoryId: category._id }))
}))
router.patch('/api/staff/builder/headers/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const header = await CategoryHeader.findById(req.params.id); const category = header && await Category.findById(header.categoryId); if (!header || !category || !(await editableCourse(req, res, category.courseId))) return
  res.json(await CategoryHeader.findByIdAndUpdate(header._id, categoryHeaderInput.partial().parse(req.body), { new: true }))
}))
router.post('/api/staff/builder/headers/:headerId/modules', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const header = await CategoryHeader.findById(req.params.headerId); const category = header && await Category.findById(header.categoryId); if (!header || !category || !(await editableCourse(req, res, category.courseId))) return
  res.status(201).json(await LearningModule.create({ ...learningModuleInput.parse(req.body), headerId: header._id }))
}))
router.patch('/api/staff/builder/modules/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const module = await LearningModule.findById(req.params.id); const header = module && await CategoryHeader.findById(module.headerId); const category = header && await Category.findById(header.categoryId); if (!module || !category || !(await editableCourse(req, res, category.courseId))) return
  res.json(await LearningModule.findByIdAndUpdate(module._id, learningModuleUpdateInput.parse(req.body), { new: true }))
}))

router.post('/api/staff/courses/:id/submit-review', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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

router.post('/api/admin/courses/:id/review', ...adminOnly, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Catalog management requires MongoDB.' })
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

router.post('/api/staff/courses/:id/modules', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Modules require MongoDB.' })
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const module = await Module.create({ ...moduleInput.parse(req.body), courseId: course._id })
  await saveAudit('module.created', 'Module', module.id, { courseId: course.id }, req.auth.sub)
  res.status(201).json(module)
}))

router.patch('/api/staff/modules/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Modules require MongoDB.' })
  const module = await Module.findByIdAndUpdate(req.params.id, moduleUpdateInput.parse(req.body), { new: true })
  if (!module) return res.status(404).json({ error: 'Module not found.' })
  await saveAudit('module.updated', 'Module', module.id, {}, req.auth.sub)
  res.json(module)
}))

router.delete('/api/staff/modules/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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

router.post('/api/staff/modules/:id/lessons', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Lessons require MongoDB.' })
  const module = await Module.findById(req.params.id)
  if (!module) return res.status(404).json({ error: 'Module not found.' })
  const lesson = await Lesson.create({ ...lessonInput.parse(req.body), moduleId: module._id })
  await saveAudit('lesson.created', 'Lesson', lesson.id, { moduleId: module.id }, req.auth.sub)
  res.status(201).json(lesson)
}))

router.patch('/api/staff/lessons/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Lessons require MongoDB.' })
  const lesson = await Lesson.findByIdAndUpdate(req.params.id, lessonUpdateInput.parse(req.body), { new: true })
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' })
  await saveAudit('lesson.updated', 'Lesson', lesson.id, {}, req.auth.sub)
  res.json(lesson)
}))

router.delete('/api/staff/lessons/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Lessons require MongoDB.' })
  const lesson = await Lesson.findByIdAndDelete(req.params.id)
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' })
  await Assignment.updateMany({ lessonId: lesson._id }, { $set: { lessonId: null } })
  await saveAudit('lesson.deleted', 'Lesson', lesson.id, {}, req.auth.sub)
  res.status(204).end()
}))
