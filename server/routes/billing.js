import express from 'express'
import { z } from 'zod'
import { Enrollment, Payment, PricingSettings, User } from '../models.js'
import { requireAdmin, requireAuth, requireStaff } from '../security.js'
import { dbState } from '../state.js'
import { asyncRoute, httpError } from '../lib/http.js'
import { saveAudit } from '../lib/audit.js'
import { getPricingSettings, paidByEnrollment, pathwayTitleById, totalAmountForPathway } from '../lib/pricing.js'

export const router = express.Router()

const pricingSettingsInput = z.object({
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
}).refine((values) => values.payInFullDiscountType !== 'percent' || (values.payInFullDiscountBroker <= 100 && values.payInFullDiscountConsultant <= 100 && values.payInFullDiscountAppraiser <= 100), { message: 'A percent discount cannot exceed 100.', path: ['payInFullDiscountBroker'] })
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
  pathway: z.enum(['broker', 'consultant', 'appraiser']),
  amount: z.coerce.number().min(1).max(1_000_000).optional(),
  feeBreakdown: feeBreakdownInput.optional(),
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
  const values = pricingSettingsInput.parse(req.body)
  const settings = await PricingSettings.findOneAndUpdate({}, values, { new: true, upsert: true, setDefaultsOnInsert: true })
  await saveAudit('pricing.updated', 'PricingSettings', settings.id, values, req.auth.sub)
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
  const enrollments = await Enrollment.find({ archivedAt: null }).sort({ createdAt: -1 }).lean()
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
      pathwayTitle: pathwayTitleById.get(row.applicant?.pathway) ?? row.applicant?.pathway,
      status: row.status,
      origin: row.origin ?? 'enrollment',
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
  const pricing = await getPricingSettings()
  const amount = values.amount ?? totalAmountForPathway(pricing, values.pathway)
  assertBreakdownTotals(values.feeBreakdown, amount)
  const existing = await Enrollment.findOne({ 'applicant.email': learner.email, 'applicant.pathway': values.pathway, archivedAt: null }).lean()
  if (existing) return res.status(409).json({ error: 'This learner already has a billing record for that program.' })
  const enrollment = await Enrollment.create({
    applicant: { name: learner.name, email: learner.email, phone: learner.phone, pathway: values.pathway },
    amount,
    currency: pricing.currency,
    status: 'approved',
    origin: 'manual',
    feeBreakdown: values.feeBreakdown ?? [],
    decisionReason: 'Billing record created by staff for a manually onboarded learner.',
    reviewedBy: req.auth.sub,
    reviewedAt: new Date(),
  })
  await saveAudit('billing.record_created', 'Enrollment', enrollment.id, { pathway: values.pathway, amount }, req.auth.sub)
  res.status(201).json({ id: enrollment.id, amount, currency: pricing.currency })
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
  const rows = await Enrollment.find({ 'applicant.email': req.auth.email }).sort({ createdAt: -1 }).lean()
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

  res.json(rows.map((row) => {
    const payments = byEnrollment.get(String(row._id)) ?? []
    const amount = Number(row.amount ?? 0)
    const amountPaid = payments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0)
    if (abandoned(row, amountPaid)) return null
    return {
      id: String(row._id),
      pathway: row.applicant.pathway,
      pathwayTitle: pathwayTitleById.get(row.applicant.pathway) ?? row.applicant.pathway,
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
