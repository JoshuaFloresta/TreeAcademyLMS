import crypto from 'node:crypto'
import express from 'express'
import { z } from 'zod'
import { Course, Enrollment, LearningProgress, Payment, PricingSettings, User } from '../models.js'
import { requireAdmin, requireAuth, requireStaff } from '../security.js'
import { dbState } from '../state.js'
import { asyncRoute, httpError } from '../lib/http.js'
import { saveAudit } from '../lib/audit.js'
import { getPricingSettings, paidByEnrollment, pathwayTitleById, totalAmountForPathway } from '../lib/pricing.js'
import { courseForPathway, pathwayForCourseSlug } from '../lib/enrollment-shared.js'
import { config, isProduction } from '../config.js'

export const router = express.Router()

// The bare shape, reused two ways below: `pricingSettingsInput` (full + cross-field validation) to
// check the MERGED result, and `pricingPatchInput` (partial) to parse whatever subset of fields the
// client actually sent. The admin UI saves one field (or one small group) at a time — see savePrice/
// savePricingPatch in AdminCoursesPage.jsx — specifically so two admins, or two fields in the same
// browser, editing at once can never stomp on each other by round-tripping a stale full snapshot.
const pricingSettingsShape = z.object({
  totalBroker: z.coerce.number().min(1).max(1_000_000),
  totalConsultant: z.coerce.number().min(1).max(1_000_000),
  totalAppraiser: z.coerce.number().min(1).max(1_000_000),
  upfrontBroker: z.coerce.number().min(1).max(1_000_000),
  upfrontConsultant: z.coerce.number().min(1).max(1_000_000),
  upfrontAppraiser: z.coerce.number().min(1).max(1_000_000),
  // No code required — see payInFullDiscountFor. `percent` values are capped at 100; a `fixed`
  // pathway value above its own total is meaningless but caught by the payable-balance floor at
  // checkout rather than here, since which cap applies depends on payInFullDiscountType.
  payInFullDiscountType: z.enum(['percent', 'fixed']),
  payInFullDiscountBroker: z.coerce.number().min(0).max(1_000_000),
  payInFullDiscountConsultant: z.coerce.number().min(0).max(1_000_000),
  payInFullDiscountAppraiser: z.coerce.number().min(0).max(1_000_000),
  installmentCount: z.coerce.number().int().min(1).max(12),
  installmentIntervalDays: z.coerce.number().int().min(1).max(365),
  // '' from a cleared <input type="date"> means "go back to counting from each learner's own
  // payment date" — preprocessed to null before z.coerce.date() ever sees it, since coercing an
  // empty string throws rather than producing null.
  installmentStartDate: z.preprocess((value) => (value === '' || value == null ? null : value), z.coerce.date().nullable()),
})
const percentDiscountCap = (values) => values.payInFullDiscountType !== 'percent' || (values.payInFullDiscountBroker <= 100 && values.payInFullDiscountConsultant <= 100 && values.payInFullDiscountAppraiser <= 100)
const pricingSettingsInput = pricingSettingsShape.refine(percentDiscountCap, { message: 'A percent discount cannot exceed 100.', path: ['payInFullDiscountBroker'] })
const pricingPatchInput = pricingSettingsShape.partial()
// Staff-set reminder for a "pay upfront only" enrollment's remaining balance — purely
// informational (shown on the learner's Statement of Account), not an in-app payment collector.
const balanceDueInput = z.object({
  balanceDueDate: z.coerce.date().nullable().optional(),
  balanceNote: z.string().trim().max(500).nullable().optional(),
})
const paymentInput = z.object({
  amount: z.coerce.number().min(1, 'Enter the amount received.').max(1_000_000),
  method: z.enum(['paymongo', 'cash', 'bank_transfer', 'gcash', 'maya', 'check', 'other']),
  kind: z.enum(['upfront', 'balance', 'full', 'adjustment']).optional(),
  receivedAt: z.coerce.date(),
  reference: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
})
// A correction to an already-recorded payment. Every field optional so a single typo can be fixed
// without re-sending the rest.
const paymentPatchInput = paymentInput.partial()
const paymentVoidInput = z.object({ reason: z.string().trim().min(3, 'Say why this payment is being voided.').max(500) })
// Negative amounts are allowed so a discount, scholarship, or written-off balance can be an itemised
// line with its own explanation ("Early-bird discount −₱5,000") rather than an unexplained drop in
// the total. The reconciliation check below still forces the lines to sum to the amount.
const feeBreakdownInput = z.array(z.object({
  label: z.string().trim().min(1, 'Each line needs a label.').max(120),
  amount: z.coerce.number().min(-1_000_000).max(1_000_000),
})).max(20)
const billingPatchInput = z.object({
  amount: z.coerce.number().min(1).max(1_000_000).optional(),
  feeBreakdown: feeBreakdownInput.optional(),
  balanceDueDate: z.coerce.date().nullable().optional(),
  balanceNote: z.string().trim().max(500).nullable().optional(),
})
// A billing record for a learner who never went through the public enrollment flow. `amount`
// defaults to the pathway's current price so staff usually only pick the learner and the pathway.
const manualBillingInput = z.object({
  learnerId: z.string().trim().min(1),
  pathway: z.string().trim().min(1).optional(),
  courseId: z.string().trim().min(1).optional(),
  batch: z.string().trim().max(100).optional(),
  allowAdditional: z.boolean().optional(),
  amount: z.coerce.number().min(1).max(1_000_000).optional(),
  feeBreakdown: feeBreakdownInput.optional(),
}).refine((data) => data.pathway || data.courseId, {
  message: 'Please select a program or course to bill.',
  path: ['pathway'],
})
// A breakdown that doesn't add up to the total would print a receipt whose lines contradict its
// own sum, so it's rejected rather than silently stored.
const assertBreakdownTotals = (breakdown, amount) => {
  if (!breakdown?.length) return
  const sum = breakdown.reduce((total, line) => total + Number(line.amount ?? 0), 0)
  if (Math.round(sum * 100) !== Math.round(Number(amount) * 100)) {
    throw httpError(422, `The breakdown adds up to ₱${sum.toLocaleString('en-PH')} but the total is ₱${Number(amount).toLocaleString('en-PH')}.`)
  }
}

router.get('/api/pricing', asyncRoute(async (_req, res) => {
  res.json(await getPricingSettings())
}))

router.patch('/api/admin/pricing', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Pricing settings require MongoDB.' })
  const patch = pricingPatchInput.parse(req.body)
  // Validated against the database's current row (via getPricingSettings, which already fills in
  // defaults for a brand-new row), never against whatever the client had cached — otherwise a
  // second field saved a moment after the first, before its refetch lands, would validate against a
  // stale picture. The actual write below only $sets the patched fields (never the merged whole),
  // so two saves landing at nearly the same moment can never stomp on each other even at the
  // database level — each only ever touches the paths it was asked to touch.
  const current = await getPricingSettings()
  pricingSettingsInput.parse({ ...current, ...patch })
  const settings = await PricingSettings.findOneAndUpdate({}, { $set: patch }, { new: true, upsert: true, setDefaultsOnInsert: true })
  await saveAudit('pricing.updated', 'PricingSettings', settings.id, patch, req.auth.sub)
  res.json(settings)
}))

// Sets/clears the reminder shown on the learner's own Statement of Account for what they still
// owe on a "pay upfront only" plan. Doesn't require any particular enrollment status — staff may
// want to set this ahead of or after the balance actually being collected offline.
router.patch('/api/staff/enrollments/:id/balance-due', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Enrollments require MongoDB.' })
  const values = balanceDueInput.parse(req.body)
  const enrollment = await Enrollment.findById(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  enrollment.payment ??= {}
  if ('balanceDueDate' in values) enrollment.payment.balanceDueDate = values.balanceDueDate
  if ('balanceNote' in values) enrollment.payment.balanceNote = values.balanceNote
  await enrollment.save()
  await saveAudit('enrollment.balance_due_set', 'Enrollment', enrollment.id, { balanceDueDate: enrollment.payment.balanceDueDate }, req.auth.sub)
  res.json({ balanceDueDate: enrollment.payment.balanceDueDate ?? null, balanceNote: enrollment.payment.balanceNote ?? '' })
}))

// --- Billing: staff-facing CRUD over the Payment ledger and the fee breakdown -------------------
// Every route here is requireAuth + requireStaff. Payments are never deleted, only voided (see the
// void route) — an admin screen should not be able to erase the record that money was received.

const publicPayment = (row) => ({
  id: String(row._id),
  enrollmentId: String(row.enrollmentId),
  amount: row.amount,
  currency: row.currency,
  method: row.method,
  kind: row.kind,
  receivedAt: row.receivedAt,
  reference: row.reference ?? '',
  note: row.note ?? '',
  voidedAt: row.voidedAt ?? null,
  voidReason: row.voidReason ?? '',
  recordedAt: row.createdAt,
})

// One row per enrollment with its ledger total — the collections overview.
router.get('/api/staff/billing', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Billing requires MongoDB.' })
  const [enrollments, courses] = await Promise.all([
    Enrollment.find({ archivedAt: null }).sort({ createdAt: -1 }).lean(),
    Course.find().select('_id title slug').lean(),
  ])
  const courseTitleBySlug = new Map(courses.map((c) => [c.slug, c.title]))
  for (const c of courses) {
    const p = pathwayForCourseSlug(c.slug)
    if (p) courseTitleBySlug.set(p, c.title)
  }
  const paid = await paidByEnrollment(enrollments.map((row) => row._id))
  const counts = new Map()
  for (const row of await Payment.find({ enrollmentId: { $in: enrollments.map((row) => row._id) }, voidedAt: null }).select('enrollmentId').lean()) {
    counts.set(String(row.enrollmentId), (counts.get(String(row.enrollmentId)) ?? 0) + 1)
  }
  res.json(enrollments.map((row) => {
    const amount = Number(row.amount ?? 0)
    const amountPaid = paid.get(String(row._id)) ?? 0
    return {
      id: String(row._id),
      name: row.applicant?.name ?? '',
      email: row.applicant?.email ?? '',
      pathway: row.applicant?.pathway,
      pathwayTitle: pathwayTitleById.get(row.applicant?.pathway) ?? courseTitleBySlug.get(row.applicant?.pathway) ?? row.applicant?.pathway,
      status: row.status,
      origin: row.origin ?? 'enrollment',
      batch: row.batch ?? 'REBLEx Batch 1',
      currency: row.currency,
      amount,
      amountPaid,
      balance: Math.max(0, amount - amountPaid),
      paymentCount: counts.get(String(row._id)) ?? 0,
      feeBreakdown: row.feeBreakdown ?? [],
      balanceDueDate: row.payment?.balanceDueDate ?? null,
      balanceNote: row.payment?.balanceNote ?? '',
      createdAt: row.createdAt,
    }
  }))
}))

// A billing record for a learner onboarded outside the public enrollment flow — no intake, no
// signed agreement, which is why it is marked origin: 'manual' rather than faking an enrollment.
router.post('/api/staff/billing/enrollments', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Billing requires MongoDB.' })
  const values = manualBillingInput.parse(req.body)
  const learner = await User.findById(values.learnerId).select('name email phone').lean()
  if (!learner) return res.status(404).json({ error: 'Learner not found.' })

  let targetCourse = null
  let pathway = values.pathway

  if (values.courseId) {
    targetCourse = await Course.findById(values.courseId)
    if (targetCourse) {
      pathway = pathwayForCourseSlug(targetCourse.slug) ?? targetCourse.slug
    }
  }

  if (!pathway && !targetCourse) {
    return res.status(400).json({ error: 'Please choose a course or program to bill.' })
  }

  if (!targetCourse && pathway) {
    targetCourse = (await courseForPathway(pathway)) ?? (await Course.findOne({ slug: `${pathway}-review` })) ?? (await Course.findOne({ slug: pathway }))
  }

  const pricing = await getPricingSettings()
  const isKnownPathway = ['broker', 'consultant', 'appraiser'].includes(pathway)
  const defaultAmount = isKnownPathway ? totalAmountForPathway(pricing, pathway) : (pricing.totalBroker ?? 14900)
  const amount = values.amount ?? defaultAmount
  assertBreakdownTotals(values.feeBreakdown, amount)

  const batch = values.batch?.trim() || 'REBLEx Batch 1'
  const emailRegex = new RegExp(`^${learner.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
  const existingApproved = await Enrollment.findOne({
    'applicant.email': emailRegex,
    'applicant.pathway': pathway,
    status: 'approved',
    archivedAt: null,
  })
  const existingDraft = await Enrollment.findOne({
    'applicant.email': emailRegex,
    'applicant.pathway': pathway,
    status: { $ne: 'approved' },
    archivedAt: null,
  })
  const existing = existingApproved ?? existingDraft

  if (existing && !values.allowAdditional) {
    const existingPayments = await Payment.find({ enrollmentId: existing._id, voidedAt: null }).lean()
    const paid = existingPayments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0)

    // Update the terms and activate/approve it, preserving any payments already made.
    existing.amount = amount
    existing.currency = pricing.currency
    existing.batch = batch
    existing.status = 'approved'
    existing.origin = existing.origin || 'manual'
    if (values.feeBreakdown?.length) existing.feeBreakdown = values.feeBreakdown
    existing.applicant = {
      ...(existing.applicant || {}),
      name: learner.name || existing.applicant?.name,
      email: learner.email.toLowerCase(),
      phone: learner.phone || existing.applicant?.phone,
      pathway,
      ...(targetCourse ? { courseId: targetCourse._id } : {}),
    }
    existing.reviewedBy = req.auth.sub
    existing.reviewedAt = new Date()
    existing.decisionReason = paid > 0
      ? 'Billing record updated and approved by staff (existing payments preserved).'
      : 'Billing record updated by staff for manually onboarded learner.'
    await existing.save()

    // Archive any lingering unapproved drafts for this learner and pathway
    await Enrollment.updateMany(
      {
        'applicant.email': emailRegex,
        'applicant.pathway': pathway,
        status: { $ne: 'approved' },
        archivedAt: null,
        _id: { $ne: existing._id },
      },
      { $set: { archivedAt: new Date() } }
    )

    if (targetCourse) {
      await LearningProgress.findOneAndUpdate(
        { learnerId: learner._id, courseId: targetCourse._id },
        { $setOnInsert: { completedModuleIds: [] } },
        { upsert: true, setDefaultsOnInsert: true }
      )
    }

    await saveAudit('billing.record_updated', 'Enrollment', existing.id, { pathway, courseId: targetCourse?._id?.toString(), amount, batch, paid }, req.auth.sub)
    return res.status(200).json({
      id: existing.id,
      amount,
      currency: pricing.currency,
      pathway,
      courseTitle: targetCourse?.title,
      batch,
      paid,
      balance: Math.max(0, amount - paid),
    })
  }

  const enrollment = await Enrollment.create({
    applicant: {
      name: learner.name,
      email: learner.email.toLowerCase(),
      phone: learner.phone,
      pathway,
      ...(targetCourse ? { courseId: targetCourse._id } : {}),
    },
    amount,
    currency: pricing.currency,
    batch,
    status: 'approved',
    origin: 'manual',
    feeBreakdown: values.feeBreakdown ?? [],
    decisionReason: 'Billing record created by staff for a manually onboarded learner.',
    reviewedBy: req.auth.sub,
    reviewedAt: new Date(),
  })

  // Ensure learner has course access so the record is never marked orphaned/unlinked
  if (targetCourse) {
    await LearningProgress.findOneAndUpdate(
      { learnerId: learner._id, courseId: targetCourse._id },
      { $setOnInsert: { completedModuleIds: [] } },
      { upsert: true, setDefaultsOnInsert: true }
    )
  }

  await saveAudit('billing.record_created', 'Enrollment', enrollment.id, { pathway, courseId: targetCourse?._id?.toString(), amount, batch }, req.auth.sub)
  res.status(201).json({ id: enrollment.id, amount, currency: pricing.currency, pathway, courseTitle: targetCourse?.title, batch })
}))

// Total, itemisation, and the balance reminder. Not the payments — those have their own routes.
router.patch('/api/staff/enrollments/:id/billing', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Billing requires MongoDB.' })
  const values = billingPatchInput.parse(req.body)
  const enrollment = await Enrollment.findById(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  const amount = values.amount ?? Number(enrollment.amount ?? 0)
  assertBreakdownTotals(values.feeBreakdown ?? enrollment.feeBreakdown, amount)
  if ('amount' in values) enrollment.amount = values.amount
  if ('feeBreakdown' in values) enrollment.feeBreakdown = values.feeBreakdown
  enrollment.payment ??= {}
  if ('balanceDueDate' in values) enrollment.payment.balanceDueDate = values.balanceDueDate
  if ('balanceNote' in values) enrollment.payment.balanceNote = values.balanceNote
  await enrollment.save()
  await saveAudit('billing.record_updated', 'Enrollment', enrollment.id, { amount: enrollment.amount }, req.auth.sub)
  res.json({ id: enrollment.id, amount: enrollment.amount, feeBreakdown: enrollment.feeBreakdown ?? [] })
}))

// Remove a billing record (archives the enrollment and clears it from active billing/statements)
router.delete('/api/staff/billing/enrollments/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Billing requires MongoDB.' })
  const enrollment = await Enrollment.findById(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Billing record not found.' })

  enrollment.archivedAt = new Date()
  await enrollment.save()

  await saveAudit('billing.record_removed', 'Enrollment', enrollment.id, {
    applicantEmail: enrollment.applicant?.email,
    pathway: enrollment.applicant?.pathway,
    batch: enrollment.batch,
  }, req.auth.sub)

  res.json({ ok: true, message: 'Billing record removed.' })
}))

router.get('/api/staff/enrollments/:id/payments', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Billing requires MongoDB.' })
  const enrollment = await Enrollment.findById(req.params.id).lean()
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  // Voided rows are included here on purpose: staff need to see that a payment was reversed and why.
  const rows = await Payment.find({ enrollmentId: enrollment._id }).sort({ receivedAt: 1 }).lean()
  const amount = Number(enrollment.amount ?? 0)
  const amountPaid = rows.filter((row) => !row.voidedAt).reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
  res.json({
    enrollment: {
      id: String(enrollment._id),
      name: enrollment.applicant?.name ?? '',
      email: enrollment.applicant?.email ?? '',
      pathwayTitle: pathwayTitleById.get(enrollment.applicant?.pathway) ?? enrollment.applicant?.pathway,
      status: enrollment.status,
      origin: enrollment.origin ?? 'enrollment',
      currency: enrollment.currency,
      amount,
      amountPaid,
      balance: Math.max(0, amount - amountPaid),
      feeBreakdown: enrollment.feeBreakdown ?? [],
      balanceDueDate: enrollment.payment?.balanceDueDate ?? null,
      balanceNote: enrollment.payment?.balanceNote ?? '',
    },
    payments: rows.map(publicPayment),
  })
}))

router.post('/api/staff/enrollments/:id/payments', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Billing requires MongoDB.' })
  const values = paymentInput.parse(req.body)
  const enrollment = await Enrollment.findById(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  const payment = await Payment.create({
    enrollmentId: enrollment._id,
    amount: values.amount,
    currency: enrollment.currency ?? 'PHP',
    method: values.method,
    kind: values.kind ?? 'balance',
    receivedAt: values.receivedAt,
    reference: values.reference ?? '',
    note: values.note ?? '',
    recordedBy: req.auth.sub,
  })
  await saveAudit('billing.payment_recorded', 'Payment', payment.id, { enrollmentId: enrollment.id, amount: values.amount, method: values.method }, req.auth.sub)
  res.status(201).json(publicPayment(payment.toObject()))
}))

router.patch('/api/staff/payments/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Billing requires MongoDB.' })
  const values = paymentPatchInput.parse(req.body)
  const payment = await Payment.findById(req.params.id)
  if (!payment) return res.status(404).json({ error: 'Payment not found.' })
  if (payment.voidedAt) return res.status(409).json({ error: 'This payment has been voided and can no longer be edited.' })
  for (const field of ['amount', 'method', 'kind', 'receivedAt', 'reference', 'note']) {
    if (field in values) payment[field] = values[field]
  }
  await payment.save()
  await saveAudit('billing.payment_updated', 'Payment', payment.id, { amount: payment.amount }, req.auth.sub)
  res.json(publicPayment(payment.toObject()))
}))

// The "delete" of this CRUD. The row survives with its figures intact and drops out of every total,
// so a reversed payment stays auditable instead of vanishing from the learner's history.
router.post('/api/staff/payments/:id/void', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Billing requires MongoDB.' })
  const { reason } = paymentVoidInput.parse(req.body)
  const payment = await Payment.findById(req.params.id)
  if (!payment) return res.status(404).json({ error: 'Payment not found.' })
  if (payment.voidedAt) return res.status(409).json({ error: 'This payment is already voided.' })
  payment.voidedAt = new Date()
  payment.voidedBy = req.auth.sub
  payment.voidReason = reason
  await payment.save()
  await saveAudit('billing.payment_voided', 'Payment', payment.id, { enrollmentId: String(payment.enrollmentId), amount: payment.amount, reason }, req.auth.sub)
  res.json(publicPayment(payment.toObject()))
}))

// The learner's own Statement of Account — every enrollment tied to their email (Enrollment has no
// learnerId; it's matched by applicant.email, same convention as migrate-backfill-enrollment-access.js),
// with the balance/due-date fields staff can set via PATCH .../balance-due above. Never exposes
// anything beyond what the applicant themselves already knows (no storage keys, no other learners'
// data) — just their own billing history.
router.get('/api/billing/me', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Billing requires MongoDB.' })
  const rows = await Enrollment.find({ 'applicant.email': req.auth.email, archivedAt: null }).sort({ createdAt: -1 }).lean()
  // Totals come from the Payment ledger, never from enrollment status. This previously read an
  // approved enrollment with no recorded payment as PAID IN FULL, which showed a ₱0 balance to
  // every learner onboarded manually — the opposite of what they actually owe.
  const ledger = rows.length
    ? await Payment.find({ enrollmentId: { $in: rows.map((row) => row._id) }, voidedAt: null }).sort({ receivedAt: 1 }).lean()
    : []
  const byEnrollment = new Map()
  for (const payment of ledger) {
    const key = String(payment.enrollmentId)
    if (!byEnrollment.has(key)) byEnrollment.set(key, [])
    byEnrollment.get(key).push(payment)
  }
  // An enrollment abandoned before payment isn't a debt — someone who opened the form and never
  // finished should not be shown a bill for a program they never joined. Anything that reached the
  // payment stage, or has money against it, still appears.
  const abandoned = (row, amountPaid) => amountPaid === 0 && ['application_pending', 'documents_pending'].includes(row.status)

  // A learner should only see statement records for programs they actually have access to.
  // If course access was removed by staff, the enrollment must not appear on their Statement of Account.
  const progress = await LearningProgress.find({ learnerId: req.auth.sub }).select('courseId').lean()
  const activeCourses = progress.length
    ? await Course.find({ _id: { $in: progress.map((p) => p.courseId) } }).select('slug title').lean()
    : []
  const activePathways = new Set([
    ...activeCourses.map((c) => c.slug),
    ...activeCourses.map((c) => pathwayForCourseSlug(c.slug)).filter(Boolean),
  ])
  const courseTitleBySlug = new Map(activeCourses.map((c) => [c.slug, c.title]))
  for (const c of activeCourses) {
    const p = pathwayForCourseSlug(c.slug)
    if (p) courseTitleBySlug.set(p, c.title)
  }

  const unlinkedApprovedIds = []
  const validRows = rows.filter((row) => {
    if (row.status === 'approved' && !activePathways.has(row.applicant?.pathway)) {
      unlinkedApprovedIds.push(row._id)
      return false
    }
    return true
  })

  if (unlinkedApprovedIds.length > 0) {
    await Enrollment.updateMany({ _id: { $in: unlinkedApprovedIds } }, { $set: { archivedAt: new Date() } })
  }

  res.json(validRows.map((row) => {
    const payments = byEnrollment.get(String(row._id)) ?? []
    const amount = Number(row.amount ?? 0)
    const amountPaid = payments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0)
    if (abandoned(row, amountPaid)) return null
    return {
      id: String(row._id),
      pathway: row.applicant.pathway,
      pathwayTitle: pathwayTitleById.get(row.applicant.pathway) ?? courseTitleBySlug.get(row.applicant.pathway) ?? row.applicant.pathway,
      batch: row.batch ?? 'REBLEx Batch 1',
      status: row.status,
      amount,
      currency: row.currency,
      plan: row.payment?.plan ?? null,
      amountPaid,
      balance: Math.max(0, amount - amountPaid),
      // Empty means no itemisation was set — the statement renders a single implicit line instead.
      feeBreakdown: (row.feeBreakdown ?? []).map((line) => ({ label: line.label, amount: line.amount })),
      payments: payments.map((payment) => ({
        id: String(payment._id),
        amount: payment.amount,
        method: payment.method,
        kind: payment.kind,
        receivedAt: payment.receivedAt,
        reference: payment.reference ?? '',
        note: payment.note ?? '',
      })),
      paidAt: payments.length ? payments[payments.length - 1].receivedAt : null,
      balanceDueDate: row.payment?.balanceDueDate ?? null,
      balanceNote: row.payment?.balanceNote ?? '',
      // Auto-generated for the upfront plan once payment is confirmed (see buildInstallmentSchedule)
      // — the learner's own preview of what's due and when, alongside the plain balanceDueDate/Note
      // reminder above for billing records that predate this or were created manually.
      installments: (row.payment?.installments ?? []).map((line) => ({ amount: line.amount, dueDate: line.dueDate, label: line.label })),
    }
  }).filter(Boolean))
}))

// Student payment gateway: initiate online checkout for remaining balance via PayMongo
router.post('/api/billing/me/:id/payment-session', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Billing requires MongoDB.' })
  const enrollment = await Enrollment.findOne({ _id: req.params.id, 'applicant.email': req.auth.email, archivedAt: null })
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })

  const payments = await Payment.find({ enrollmentId: enrollment._id, voidedAt: null }).lean()
  const amountPaid = payments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0)
  const totalAmount = Number(enrollment.amount ?? 0)
  const balance = Math.max(0, totalAmount - amountPaid)

  if (balance <= 0) {
    return res.status(400).json({ error: 'This enrollment has already been settled in full.' })
  }

  const { amount: requestedAmount } = z.object({
    amount: z.coerce.number().min(100, 'Minimum payment is ₱100.').max(1_000_000).optional(),
  }).parse(req.body ?? {})

  const chargeAmount = Math.min(balance, requestedAmount ? Number(requestedAmount) : balance)
  if (chargeAmount < 100) {
    return res.status(400).json({ error: 'Minimum payable amount is ₱100.' })
  }

  const programTitle = pathwayTitleById.get(enrollment.applicant?.pathway) ?? enrollment.applicant?.pathway ?? 'Review Program'
  const referenceNumber = `${enrollment._id}-bal-${Date.now()}`

  if (!config.paymongo.secretKey) {
    if (config.demoMode || !isProduction) {
      return res.json({
        checkoutUrl: `${config.clientUrl}/statement?payment=success&demo=true&enrollment=${enrollment.id}&amount=${chargeAmount}`,
        mode: 'demo_checkout',
        message: 'Demo mode payment session generated.',
      })
    }
    return res.json({
      checkoutUrl: config.paymongo.paymentLink,
      mode: 'payment_link_fallback',
      message: 'The PayMongo payment page is open.',
    })
  }

  const payload = {
    data: {
      attributes: {
        billing: {
          name: enrollment.applicant.name,
          email: enrollment.applicant.email,
          phone: enrollment.applicant.phone,
        },
        line_items: [{
          name: `${programTitle} — Balance payment`,
          description: `Remaining balance payment for ${enrollment.applicant.name} (${programTitle})`,
          amount: Math.round(chargeAmount * 100),
          currency: enrollment.currency ?? 'PHP',
          quantity: 1,
        }],
        payment_method_types: config.paymongo.paymentMethods,
        send_email_receipt: true,
        show_description: true,
        show_line_items: true,
        success_url: `${config.clientUrl}/statement?payment=success&enrollment=${enrollment.id}`,
        cancel_url: `${config.clientUrl}/statement?payment=cancelled&enrollment=${enrollment.id}`,
        reference_number: referenceNumber,
        metadata: {
          enrollment_id: String(enrollment._id),
          payment_type: 'balance_payment',
          charge_amount: String(chargeAmount),
          learner_id: req.auth.sub,
        },
      },
    },
  }

  const response = await fetch('https://api.paymongo.com/v2/checkout_sessions', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.paymongo.secretKey}:`).toString('base64')}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `treeacademy-bal-${referenceNumber}`,
    },
    body: JSON.stringify(payload),
  })

  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result?.data?.attributes?.checkout_url) {
    console.error('PayMongo balance checkout error', response.status, result)
    return res.status(502).json({ error: 'PayMongo could not start checkout. Please try again shortly.' })
  }

  await saveAudit('billing.balance_checkout_created', 'Enrollment', enrollment.id, {
    checkoutId: result.data.id,
    chargeAmount,
  }, req.auth.sub)

  res.json({ checkoutUrl: result.data.attributes.checkout_url, mode: 'checkout_session' })
}))

// Dev/demo-only: simulate balance payment completion so it can be verified on localhost
router.post('/api/billing/me/:id/demo/pay-balance', requireAuth, asyncRoute(async (req, res) => {
  if (isProduction && !config.demoMode) return res.status(404).end()
  const enrollment = await Enrollment.findOne({ _id: req.params.id, 'applicant.email': req.auth.email, archivedAt: null })
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })

  const payments = await Payment.find({ enrollmentId: enrollment._id, voidedAt: null }).lean()
  const amountPaid = payments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0)
  const totalAmount = Number(enrollment.amount ?? 0)
  const balance = Math.max(0, totalAmount - amountPaid)

  if (balance <= 0) return res.status(400).json({ error: 'This enrollment has already been settled in full.' })

  const { amount: requestedAmount } = z.object({
    amount: z.coerce.number().min(1).max(1_000_000).optional(),
  }).parse(req.body ?? {})

  const chargeAmount = Math.min(balance, requestedAmount ? Number(requestedAmount) : balance)
  const payment = await Payment.create({
    enrollmentId: enrollment._id,
    amount: chargeAmount,
    currency: enrollment.currency ?? 'PHP',
    method: 'paymongo',
    kind: 'balance',
    receivedAt: new Date(),
    reference: `demo_${crypto.randomUUID()}`,
    note: 'Demo balance payment via in-app gateway',
  })

  await saveAudit('billing.balance_demo_paid', 'Enrollment', enrollment.id, { amount: chargeAmount }, req.auth.sub)
  res.json({ success: true, payment: publicPayment(payment.toObject()) })
}))
