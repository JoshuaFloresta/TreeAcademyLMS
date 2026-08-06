import { config } from '../config.js'
import { sendTemplatedEmail } from '../email.js'
import { applyIntakeToProfile } from '../profile.js'
import { Course, Enrollment, LearningProgress, Payment, User } from '../models.js'
import { dbState, memory } from '../state.js'
import { bestEffortEmail, issueAccountSetupUrl, sendCredentialsEmail } from './accounts.js'
import { claimVoucherUse } from './vouchers.js'
import { buildInstallmentSchedule, getPricingSettings, pathwayTitleById, planLabel } from './pricing.js'

export async function findEnrollment(enrollmentId) {
  if (dbState.ready) return Enrollment.findById(enrollmentId)
  return memory.enrollments.get(enrollmentId)
}

// `amount` is always the NET payable — see applyVoucherToEnrollment. `discount` is what the
// applicant is told about their own voucher: the code and the computed figures only, never the
// voucher's remaining uses or expiry, which are the academy's business and not the applicant's.
export const publicEnrollment = (enrollment) => ({
  id: enrollment._id?.toString() ?? enrollment.id,
  status: enrollment.status,
  amount: enrollment.amount,
  currency: enrollment.currency,
  discount: enrollment.voucher?.code
    ? {
      code: enrollment.voucher.code,
      discountType: enrollment.voucher.discountType,
      discountValue: enrollment.voucher.discountValue,
      // 'total' | 'upfront' — which figure the payment step should show the saving against.
      appliesTo: enrollment.voucher.appliesTo ?? 'total',
      discountAmount: enrollment.voucher.discountAmount,
      baseAmount: enrollment.voucher.baseAmount ?? enrollment.voucher.listAmount,
      listAmount: enrollment.voucher.listAmount,
    }
    : null,
})

// Reserved regardless of which course currently holds them — pricing, checkout, and
// provisionLearnerAccount's access grant all join a course by matching exactly this slug, so it can
// neither be moved off one of the 3 pathway courses nor reused by a different one.
export const RESERVED_COURSE_SLUGS = ['broker-review', 'consultant-review', 'appraiser-review']
export const courseForPathway = (pathway) => Course.findOne({ slug: `${pathway}-review` })
// Which agreement a pathway signs. Single source of truth — the document route validates against
// this and the application route reports it as the next step, so the two can't drift apart.
export const pathwayDocumentType = (pathway) => (pathway === 'consultant' ? 'reclex' : 'realex-reblex')

// Admin-customizable via the "payment_receipt" template — sent alongside the credentials email
// whenever a payment is confirmed (markEnrollmentPaid and the staff-decision fallback routes), so
// the applicant has a record of exactly what was charged even on the "pay upfront only" plan.
export function sendPaymentReceiptEmail(enrollment, setupUrl) {
  const payment = enrollment.payment ?? {}
  const totalAmount = Number(enrollment.amount ?? 0)
  const planAmount = Number(payment.planAmount ?? totalAmount)
  const balanceDue = Math.max(0, totalAmount - planAmount)
  const peso = (value) => `₱${value.toLocaleString('en-PH')}`
  // A voucher shows up on the receipt as the figure it came off plus the saving itself. Which
  // figure that is depends on the voucher's scope, so the LABEL is a variable rather than literal
  // text in the template: a 'total' code discounts the enrollment price, an 'upfront' one discounts
  // only the reservation fee (leaving the total, and therefore the balance below, untouched).
  // hasDiscount drives the {{#hasDiscount}} sections — empty string, not false, so a template that
  // prints it raw shows nothing rather than the word "false".
  const voucher = enrollment.voucher
  const cutsUpfront = voucher?.appliesTo === 'upfront'
  const discountVars = voucher?.code
    ? {
      hasDiscount: '1',
      voucherCode: voucher.code,
      discountLabel: voucher.discountType === 'percent' ? `${voucher.discountValue}% off` : `${peso(Number(voucher.discountValue))} off`,
      discountAmount: peso(Number(voucher.discountAmount ?? 0)),
      discountBaseLabel: cutsUpfront ? 'Reservation fee before discount' : 'Price before discount',
      discountBaseAmount: peso(Number(voucher.baseAmount ?? voucher.listAmount ?? totalAmount)),
      discountScopeNote: cutsUpfront
        ? 'on the amount due today. Your enrollment total is unchanged, so this saving is reflected in the balance below.'
        : 'on your enrollment total.',
    }
    : { hasDiscount: '', voucherCode: '', discountLabel: '', discountAmount: '', discountBaseLabel: '', discountBaseAmount: '', discountScopeNote: '' }
  return sendTemplatedEmail('payment_receipt', enrollment.applicant.email, {
    name: enrollment.applicant.name,
    email: enrollment.applicant.email,
    pathway: pathwayTitleById.get(enrollment.applicant.pathway) ?? enrollment.applicant.pathway,
    planLabel: planLabel[payment.plan] ?? 'Payment',
    amountPaid: peso(planAmount),
    totalAmount: peso(totalAmount),
    balanceDue: peso(balanceDue),
    ...discountVars,
    referenceNumber: payment.referenceNumber ?? enrollment._id?.toString() ?? enrollment.id,
    transactionId: payment.transactionId ?? '—',
    paidAt: (payment.paidAt ? new Date(payment.paidAt) : new Date()).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }),
    // First-time accounts link straight to the password-setup page instead of a bare login form.
    loginUrl: setupUrl ?? `${config.clientUrl}/auth`,
  })
}

export async function provisionLearnerAccount(enrollment) {
  const applicant = enrollment.applicant
  if (!dbState.ready) {
    memory.users.set(applicant.email, { name: applicant.name, email: applicant.email, status: 'active', role: 'learner' })
    return { delivery: 'demo_preview', setupUrl: null }
  }
  let learner = await User.findOne({ email: applicant.email })
  if (!learner) learner = new User({ name: applicant.name, email: applicant.email, role: 'learner' })
  applyIntakeToProfile(learner, enrollment.intake?.data)
  const alreadyActive = learner.status === 'active'
  let setupUrl = null
  if (!alreadyActive) {
    learner.status = 'active'
    setupUrl = await issueAccountSetupUrl(learner)
  }
  // Grant access to the course tied to the pathway just approved — a returning learner approved
  // for a second pathway gains that course too, without losing access to their first.
  const pathwayCourse = await courseForPathway(applicant.pathway)
  if (pathwayCourse) await LearningProgress.findOneAndUpdate(
    { learnerId: learner._id, courseId: pathwayCourse._id }, { $setOnInsert: { completedModuleIds: [] } }, { upsert: true, setDefaultsOnInsert: true })
  if (alreadyActive) return { delivery: 'existing_active_account', setupUrl: null }
  const delivery = await bestEffortEmail(sendCredentialsEmail({ name: learner.name, email: learner.email, setupUrl, pathway: pathwayTitleById.get(applicant.pathway) ?? applicant.pathway }), 'enrollment_credentials email')
  return { ...delivery, setupUrl }
}

// The generic-course sibling of provisionLearnerAccount above — granted the moment a course's
// agreement PDF is signed (no payment gate, so no separate "approved" step to wait on) and keyed
// directly by course rather than resolved via a pathway. No applyIntakeToProfile call: a generic
// application collects only name/email/phone, not the pathway's admission questionnaire.
export async function provisionCourseEnrollmentAccess(course, applicant) {
  let learner = await User.findOne({ email: applicant.email })
  if (!learner) learner = new User({ name: applicant.name, email: applicant.email, role: 'learner' })
  const alreadyActive = learner.status === 'active'
  let setupUrl = null
  if (!alreadyActive) {
    learner.status = 'active'
    setupUrl = await issueAccountSetupUrl(learner)
  }
  await LearningProgress.findOneAndUpdate(
    { learnerId: learner._id, courseId: course._id }, { $setOnInsert: { completedModuleIds: [] } }, { upsert: true, setDefaultsOnInsert: true })
  if (alreadyActive) return { delivery: 'existing_active_account', setupUrl: null }
  const delivery = await bestEffortEmail(sendCredentialsEmail({ name: learner.name, email: learner.email, setupUrl, pathway: course.title }), 'enrollment_credentials email')
  return { ...delivery, setupUrl }
}

// Shared by the real PayMongo webhook and the dev-only demo/mark-paid shortcut. Payment
// confirmation now provisions the learner account immediately — no staff review step — but only
// from here, which only ever runs after PayMongo's signature-verified webhook (or, in demo mode,
// an explicit dev action) confirms funds; a browser redirect alone still never grants access.
// Writes one ledger row (see the Payment model). Best-effort by design: in the webhook path the
// enrollment being marked paid and the learner getting access matter more than the statement line,
// and migrate-payments.js can backfill anything missed. Never throws.
async function recordPayment({ enrollment, amount, method, kind, receivedAt, reference, note, recordedBy }) {
  if (!dbState.ready) return null
  try {
    return await Payment.create({
      enrollmentId: enrollment._id ?? enrollment.id,
      amount: Number(amount ?? 0),
      currency: enrollment.currency ?? 'PHP',
      method,
      kind,
      receivedAt: receivedAt ?? new Date(),
      reference: reference ?? '',
      note: note ?? '',
      recordedBy: recordedBy ?? null,
    })
  } catch (error) {
    console.error('payment ledger write failed:', error.message)
    return null
  }
}

export async function markEnrollmentPaid(enrollment, paymentPatch) {
  const wasAwaitingPayment = ['payment_pending', 'contract_signed'].includes(enrollment.status)
  if (wasAwaitingPayment) {
    enrollment.status = 'approved'
    enrollment.decisionReason = 'Auto-approved on payment confirmation.'
    enrollment.reviewedAt = new Date()
  }
  enrollment.payment = { ...(enrollment.payment?.toObject?.() ?? enrollment.payment ?? {}), ...paymentPatch }

  // Guarded on wasAwaitingPayment so a repeated webhook delivery for an already-approved enrollment
  // can never double-apply the discount or regenerate a schedule on top of one staff may have
  // already started collecting against.
  if (wasAwaitingPayment) {
    const settled = enrollment.payment
    // Pay-in-full discount: deferred from payment-session (see there) until payment is actually
    // confirmed, so a cancelled/abandoned checkout never permanently discounts an unpaid enrollment.
    // Re-checking !enrollment.voucher here (not just trusting the stored amount from checkout-creation
    // time) closes a narrow race: opening a "pay in full" checkout, then going back and applying a
    // voucher, then completing that original stale checkout link — without this guard the voucher
    // discount and the stale pay-in-full discount could both land on `amount`, even though the two
    // are meant to be mutually exclusive.
    if (settled.plan === 'full' && !enrollment.voucher && Number(settled.payInFullDiscountAmount) > 0) {
      const discount = Number(settled.payInFullDiscountAmount)
      enrollment.feeBreakdown = [{ label: 'Enrollment fee', amount: enrollment.amount }, { label: 'Pay-in-full discount', amount: -discount }]
      enrollment.amount = Math.max(0, Number(enrollment.amount) - discount)
    }
    // Upfront plan: turn whatever remains into a dated, staff-tracked installment schedule instead
    // of the old single free-text balance reminder.
    if (settled.plan === 'upfront') {
      const pricing = await getPricingSettings()
      const balance = Math.max(0, Number(enrollment.amount) - Number(settled.planAmount ?? 0))
      enrollment.payment.installments = buildInstallmentSchedule({ balance, count: pricing.installmentCount, intervalDays: pricing.installmentIntervalDays })
    }
  }

  if (dbState.ready) await enrollment.save()
  if (!wasAwaitingPayment) return null
  // Read from the MERGED payment object, not from paymentPatch. plan/planAmount are written at
  // checkout-creation time and the webhook's patch carries only provider/transactionId/paidAt — so
  // reading the patch alone left planAmount undefined, fell through to the full enrollment price,
  // and recorded every upfront payer as having settled in full.
  const settled = enrollment.payment ?? {}
  await recordPayment({
    enrollment,
    amount: settled.planAmount ?? enrollment.amount,
    method: 'paymongo',
    kind: settled.plan === 'upfront' ? 'upfront' : 'full',
    receivedAt: settled.paidAt,
    reference: settled.transactionId ?? settled.referenceNumber,
  })
  const invitation = await provisionLearnerAccount(enrollment)
  // Claimed AFTER provisioning so the redemption log can name the account it created, and read
  // back by email rather than returned from provisionLearnerAccount — that return value is echoed
  // into an API response by the demo route, and the User document carries a password hash.
  // Selecting only _id keeps it that way. The unique index inside claimVoucherUse, not this call
  // site, is what stops a replayed webhook counting the voucher twice.
  const learner = dbState.ready ? await User.findOne({ email: enrollment.applicant.email }).select('_id') : null
  await claimVoucherUse(enrollment, learner)
  await bestEffortEmail(sendPaymentReceiptEmail(enrollment, invitation?.setupUrl), 'payment_receipt email')
  return invitation
}

export function paymentReturnUrl(state, enrollmentId) {
  const url = new URL('/enroll', config.clientUrl)
  url.searchParams.set('payment', state)
  url.searchParams.set('enrollment', enrollmentId)
  return url.toString()
}
