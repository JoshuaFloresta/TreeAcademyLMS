import express from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { Assignment, Badge, BadgeRule, Certificate, CertificateTemplate, Course, LearningProgress, Module, Quiz, StudentBadge, User } from '../models.js'
import { requireAuth, requireStaff } from '../security.js'
import { renderCertificate, saveCertificateTemplate } from '../certificates.js'
import { getFile } from '../storage.js'
import { dbState } from '../state.js'
import { asyncRoute, sendPrivateDownload } from '../lib/http.js'
import { certificateUpload } from '../lib/uploads.js'
import { saveAudit } from '../lib/audit.js'
import { runBadgeRules } from '../lib/badge-rules.js'

export const router = express.Router()

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

async function issueCertificate({ template, learner, issuedBy }) {
  const existing = await Certificate.findOne({ templateId: template._id, learnerId: learner._id })
  if (existing) return existing
  const fileKey = await renderCertificate(template, learner)
  const certificate = await Certificate.create({ templateId: template._id, learnerId: learner._id, recipientName: learner.name, targetId: template.targetId, fileKey, issuedBy })
  await saveAudit('certificate.issued', 'Certificate', certificate.id, { templateId: template.id, learnerId: learner.id }, issuedBy)
  return certificate
}

router.get('/api/badges/me', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Badges require MongoDB.' })
  const badges = await StudentBadge.find({ learnerId: req.auth.sub }).populate('badgeId', 'title description color icon').sort({ createdAt: -1 }).lean()
  res.json(badges)
}))

router.post('/api/staff/badges', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Badge management requires MongoDB.' })
  const values = badgeInput.parse(req.body)
  const badge = await Badge.create({ ...values, createdBy: req.auth.sub })
  await saveAudit('badge.created', 'Badge', badge.id, { title: badge.title }, req.auth.sub)
  res.status(201).json(badge)
}))

router.post('/api/staff/badges/:badgeId/award', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Badge awards require MongoDB.' })
  const { learnerId, note } = awardInput.parse(req.body)
  const [badge, learner] = await Promise.all([Badge.findById(req.params.badgeId), User.findOne({ _id: learnerId, role: 'learner' })])
  if (!badge || !learner) return res.status(404).json({ error: 'Badge or learner not found.' })
  const award = await StudentBadge.findOneAndUpdate({ badgeId: badge._id, learnerId: learner._id }, { awardedBy: req.auth.sub, note }, { new: true, upsert: true, setDefaultsOnInsert: true })
  await saveAudit('badge.awarded', 'StudentBadge', award.id, { badgeId: badge.id, learnerId: learner.id }, req.auth.sub)
  res.status(201).json(award)
}))

router.get('/api/staff/badges', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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

router.get('/api/staff/badge-rules', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Badge rules require MongoDB.' })
  const filter = {}
  if (req.query.courseId) filter.courseId = req.query.courseId
  const rules = await BadgeRule.find(filter).sort({ createdAt: -1 }).lean()
  res.json(await Promise.all(rules.map(publicBadgeRule)))
}))

router.post('/api/staff/badge-rules', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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
router.patch('/api/staff/badge-rules/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
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

router.delete('/api/staff/badge-rules/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Badge rules require MongoDB.' })
  const rule = await BadgeRule.findByIdAndDelete(req.params.id)
  if (!rule) return res.status(404).json({ error: 'Rule not found.' })
  await saveAudit('badge_rule.deleted', 'BadgeRule', req.params.id, {}, req.auth.sub)
  res.status(204).end()
}))

router.post('/api/staff/certificate-templates', requireAuth, requireStaff, certificateUpload.single('layout'), asyncRoute(async (req, res) => {
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

router.post('/api/staff/certificates/issue', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Certificate issuing requires MongoDB.' })
  const { templateId, learnerId } = certificateIssueInput.parse(req.body)
  const [template, learner] = await Promise.all([CertificateTemplate.findById(templateId), User.findOne({ _id: learnerId, role: 'learner' })])
  if (!template || !learner) return res.status(404).json({ error: 'Certificate template or learner not found.' })
  const certificate = await issueCertificate({ template, learner, issuedBy: req.auth.sub })
  res.status(201).json(certificate)
}))

router.post('/api/learning/modules/:moduleId/complete', requireAuth, asyncRoute(async (req, res) => {
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

router.get('/api/certificates/:id/download', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Certificate downloads require MongoDB.' })
  const certificate = await Certificate.findById(req.params.id)
  if (!certificate) return res.status(404).json({ error: 'Certificate not found.' })
  if (String(certificate.learnerId) !== req.auth.sub && !['instructor', 'admin'].includes(req.auth.role)) return res.status(403).json({ error: 'You cannot download this certificate.' })
  sendPrivateDownload(res, await getFile(certificate.fileKey), `Tree-Academy-Certificate-${certificate.id}.pdf`, 'application/pdf')
}))
