import crypto from 'node:crypto'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { config, isProduction } from '../config.js'
import { catalog } from '../catalog.js'
import { Course, CourseEnrollment, Enrollment, Voucher } from '../models.js'
import { requireAuth, requireStaff } from '../security.js'
import { sendEnrollmentDocumentsEmail, sendTemplatedEmail } from '../email.js'
import { createApplicationPdf, createFilledAgreement, createFilledDocument, createFilledDocumentBytes } from '../enrollment-documents.js'
import { getFile } from '../storage.js'
import { dbState, memory } from '../state.js'
import { asyncRoute, sendPrivateDownload } from '../lib/http.js'
import { saveAudit } from '../lib/audit.js'
import { bestEffortEmail } from '../lib/accounts.js'
import { courseIsAvailable, pathwayCourseIsOpen } from '../lib/course-visibility.js'
import { getPricingSettings, paidByEnrollment, payInFullDiscountFor, totalAmountForPathway, upfrontAmountForPathway } from '../lib/pricing.js'
import {
  MINIMUM_CHARGE_AMOUNT, VOUCHER_EDIT_STATUSES, applyVoucherToEnrollment, clearVoucherFromEnrollment,
  upfrontChargeFor, voucherApplicantRejection, voucherBaseAmount, voucherDiscountFor, voucherRedeemInput,
  voucherRejection, voucherTargetsUpfront,
} from '../lib/vouchers.js'
import {
  courseForPathway, findEnrollment, markEnrollmentPaid, pathwayDocumentType, paymentReturnUrl,
  provisionCourseEnrollmentAccess, provisionLearnerAccount, publicEnrollment, sendPaymentReceiptEmail,
} from '../lib/enrollment-shared.js'
import { ENROLLMENT_DOCUMENT_TYPES, enrollmentDocuments } from '../lib/enrollment-doc-meta.js'

const id = () => crypto.randomUUID()

export const router = express.Router()

const enrollmentInput = z.object({
  name: z.string().trim().min(2).max(100),
  // Trimmed to match applicationInput below: a pasted address with a trailing space used to be
  // stored untrimmed here and then never compare equal to its own trimmed self on the next step.
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(30).optional(),
  pathway: z.enum(['broker', 'consultant', 'appraiser']),
})
const paymentSessionInput = z.object({ plan: z.enum(['full', 'upfront']).optional() })
const requiredApplicationText = (label, max = 500) => z.string().trim().min(1, `${label} is required.`).max(max)
const requiredAcknowledgement = z.boolean().refine((value) => value, 'This acknowledgment is required.')
const applicationInput = z.object({
  full_name: requiredApplicationText('Full legal name', 100),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date of birth.'),
  mobile: requiredApplicationText('Mobile number', 30),
  email: z.string().trim().email('Enter a valid email address.').max(254),
  address: requiredApplicationText('Complete address', 500),
  emergency_name: requiredApplicationText('Emergency contact name', 100),
  emergency_mobile: requiredApplicationText('Emergency contact number', 30),
  school: requiredApplicationText('School or university', 200),
  degree: requiredApplicationText('Degree completed', 200),
  grad_year: z.coerce.number().int().min(1950).max(2035),
  attempts: requiredApplicationText('Previous REBLEX attempts', 100),
  prc_status: requiredApplicationText('PRC application status', 100),
  computation_level: requiredApplicationText('Computation comfort', 100),
  situational_level: requiredApplicationText('Situational-question comfort', 100),
  study_hours: requiredApplicationText('Weekly study time', 100),
  internet: requiredApplicationText('Internet access', 100),
  device: requiredApplicationText('Primary device', 100),
  commit_attend: requiredAcknowledgement,
  commit_study: requiredAcknowledgement,
  commit_assess: requiredAcknowledgement,
  commit_remediate: requiredAcknowledgement,
  commit_communicate: requiredAcknowledgement,
  agree_nonsharing: requiredAcknowledgement,
  agree_integrity: requiredAcknowledgement,
  agree_privacy: requiredAcknowledgement,
  agree_recording: requiredAcknowledgement,
}).passthrough()
const signatureInput = z.object({
  signatureName: z.string().trim().min(2, 'Please type your full legal name.').max(100),
  signatureDataUrl: z.string().max(300000).regex(/^data:image\/png;base64,[a-z0-9+/=]+$/i, 'Please provide a valid signature.'),
  consent: z.literal(true, { error: 'Electronic-signature consent is required.' }),
})
const realexReblexInput = z.object({
  exam_type: z.enum(['REBLEX', 'REALEX']),
  p_name: requiredApplicationText('Participant name', 100),
  p_address: requiredApplicationText('Address', 500),
  p_contact: requiredApplicationText('Contact number', 30),
  p_email: z.string().trim().email('Enter a valid email address.'),
  p_prc_app: requiredApplicationText('PRC application status', 300),
  p_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.'),
  prov_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.'),
})
const reclexInput = z.object({
  agmt_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the agreement date.'),
  agmt_place: requiredApplicationText('Agreement place', 150),
  r_name: requiredApplicationText('Registrant name', 100),
  r_lic_type: requiredApplicationText('License type', 100),
  r_lic_no: requiredApplicationText('License number', 100),
  r_contact: requiredApplicationText('Contact number', 30),
  r_email: z.string().trim().email('Enter a valid email address.'),
  r_address: requiredApplicationText('Address', 500),
  r_target_exam: requiredApplicationText('Target examination', 100),
  a_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the acknowledgment date.'),
  b_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the signature date.'),
  agmt_no: z.string().trim().max(100).optional(),
  w1_name: z.string().trim().max(100).optional(),
  w2_name: z.string().trim().max(100).optional(),
})
// The contact-info half of a generic course application (POST /api/course-agreements/:slug/apply)
// — deliberately short, unlike the pathway flow's full intake questionnaire, since a generic
// course has no equivalent admission form beyond its own agreement PDF.
const courseApplicantInput = z.object({
  name: z.string().trim().min(2, 'Enter your full name.').max(100),
  email: z.string().trim().email('Enter a valid email address.').max(254),
  phone: z.string().trim().max(30).optional(),
})
// The PDF-field half is admin-defined per course, so it's validated loosely — safe because filling
// only ever reads keys present in the course's stored `agreementTemplate.fields`, so any unexpected
// key here is simply ignored rather than acted on.
const agreementFieldsInput = z.record(z.string(), z.union([z.string(), z.boolean()])).optional()

router.post('/api/enrollments', asyncRoute(async (req, res) => {
  const applicant = enrollmentInput.parse(req.body)
  if (dbState.ready && !pathwayCourseIsOpen(await courseForPathway(applicant.pathway))) {
    return res.status(409).json({ error: 'Enrollment for this program is not currently open.' })
  }
  const pricing = await getPricingSettings()
  const enrollmentData = { applicant: { ...applicant, email: applicant.email.toLowerCase() }, amount: totalAmountForPathway(pricing, applicant.pathway), currency: pricing.currency, status: 'application_pending' }
  const enrollment = dbState.ready ? await Enrollment.create(enrollmentData) : { ...enrollmentData, id: id() }
  if (!dbState.ready) memory.enrollments.set(enrollment.id, enrollment)
  await saveAudit('enrollment.created', 'Enrollment', enrollment._id?.toString() ?? enrollment.id, { pathway: applicant.pathway })
  if (dbState.ready) {
    sendTemplatedEmail('enrollment_received', applicant.email, { name: applicant.name, pathway: applicant.pathway, enrollUrl: `${config.clientUrl}/enroll` })
      .catch((emailError) => console.error('enrollment_received email failed:', emailError.message))
  }

  res.status(201).json({ ...publicEnrollment(enrollment), nextStep: 'application' })
}))

router.post('/api/enrollments/:id/application', asyncRoute(async (req, res) => {
  const values = applicationInput.parse(req.body?.data)
  const enrollment = await findEnrollment(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  if (!['application_pending', 'documents_pending'].includes(enrollment.status)) return res.status(409).json({ error: 'This application can no longer be changed.' })
  const pdfKey = await createApplicationPdf({ data: values })
  // Name, phone, and email are all re-synced from the form on every submit so going Back to correct
  // any of them works. Accepting a changed email is safe only because the status guard above limits
  // this route to the pre-payment window — no account exists yet, so there is no credential to
  // redirect. Rejecting the change instead stranded anyone who mistyped their address, since the
  // account-setup email would go somewhere they could never read.
  enrollment.applicant.name = values.full_name
  enrollment.applicant.phone = values.mobile
  enrollment.applicant.email = values.email.toLowerCase()
  enrollment.intake = { data: values, submittedAt: new Date(), pdfKey }
  enrollment.status = 'documents_pending'
  if (dbState.ready) await enrollment.save()
  await saveAudit('enrollment.application_submitted', 'Enrollment', req.params.id)
  // Must match the document route's own requiredType check — hardcoding 'realex-reblex' told a
  // consultant applicant to sign the broker agreement, which that route would then reject.
  res.json({ ...publicEnrollment(enrollment), nextStep: pathwayDocumentType(enrollment.applicant.pathway) })
}))

router.post('/api/enrollments/:id/documents/:type', asyncRoute(async (req, res) => {
  const type = req.params.type
  if (!['realex-reblex', 'reclex'].includes(type)) return res.status(404).json({ error: 'Unknown enrollment document.' })
  const { signatureName, signatureDataUrl, consent } = signatureInput.parse(req.body)
  const fields = (type === 'realex-reblex' ? realexReblexInput : reclexInput).parse(req.body.fields)
  const enrollment = await findEnrollment(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  if (!['documents_pending', 'documents_complete', 'payment_pending'].includes(enrollment.status)) return res.status(409).json({ error: 'Complete the application before this document.' })
  if (signatureName.localeCompare(enrollment.applicant.name, undefined, { sensitivity: 'accent' }) !== 0) return res.status(422).json({ error: 'Your typed electronic signature must match the legal name used for enrollment.' })
  if (!consent) return res.status(422).json({ error: 'Electronic-signature consent is required.' })

  const requiredType = pathwayDocumentType(enrollment.applicant.pathway)
  if (type !== requiredType) {
    return res.status(409).json({ error: 'This enrollment requires the correct pathway document before payment.' })
  }

  const pdfKey = await createFilledDocument({ type, fields, signatureDataUrl, signatureName })
  const documentName = type === 'realex-reblex' ? 'realexReblex' : 'reclex'
  enrollment.documents ??= {}
  enrollment.documents[documentName] = { pdfKey, signedAt: new Date(), signatureName }
  enrollment.status = 'payment_pending'
  if (dbState.ready) await enrollment.save()

  await bestEffortEmail(sendEnrollmentDocumentsEmail({
    enrollmentId: req.params.id,
    applicant: enrollment.applicant,
    documentKeys: [
      { key: enrollment.intake.pdfKey, filename: `PASS-FIRST-Application-${req.params.id}.pdf` },
      { key: pdfKey, filename: type === 'realex-reblex' ? `REALEX-REBLEX-${req.params.id}.pdf` : `RECLEX-${req.params.id}.pdf` },
    ],
  }), 'enrollment documents notification')

  await saveAudit(`enrollment.document_${type}_submitted`, 'Enrollment', req.params.id)
  res.json({ ...publicEnrollment(enrollment), nextStep: 'payment', documentsComplete: true })
}))

router.post('/api/enrollments/:id/documents/:type/download', asyncRoute(async (req, res) => {
  const type = req.params.type
  if (!['realex-reblex', 'reclex'].includes(type)) return res.status(404).json({ error: 'Unknown enrollment document.' })
  const { signatureName, signatureDataUrl, consent } = signatureInput.parse(req.body)
  const fields = (type === 'realex-reblex' ? realexReblexInput : reclexInput).parse(req.body.fields)
  const enrollment = await findEnrollment(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  if (signatureName.localeCompare(enrollment.applicant.name, undefined, { sensitivity: 'accent' }) !== 0) return res.status(422).json({ error: 'Your typed electronic signature must match the legal name used for enrollment.' })
  if (!consent) return res.status(422).json({ error: 'Electronic-signature consent is required.' })

  const pdfBytes = await createFilledDocumentBytes({ type, fields, signatureDataUrl, signatureName })
  const filename = type === 'realex-reblex' ? `REALEX-REBLEX-${req.params.id}.pdf` : `RECLEX-${req.params.id}.pdf`
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(Buffer.from(pdfBytes))
}))

// Public and unauthenticated like the rest of the enrollment flow — the enrollment id in the path
// is the only thing tying a redemption to an applicant. That also makes this the one endpoint that
// will tell an anonymous caller whether a string is a real voucher code, so it gets a much tighter
// rate limit than the global one and a uniform rejection message (see voucherRejection).
const voucherLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: config.voucherAttemptLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many voucher attempts. Please wait a few minutes before trying another code.' },
})

router.post('/api/enrollments/:id/voucher', voucherLimiter, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Vouchers require MongoDB.' })
  const { code } = voucherRedeemInput.parse(req.body)
  const enrollment = await findEnrollment(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  if (!VOUCHER_EDIT_STATUSES.includes(enrollment.status)) return res.status(409).json({ error: 'This enrollment can no longer be changed.' })

  const voucher = await Voucher.findOne({ code })
  const rejection = voucherRejection(voucher) ?? await voucherApplicantRejection(voucher, enrollment.applicant.email)
  if (rejection) return res.status(422).json({ error: rejection })

  // Refused up front rather than at checkout: PayMongo cannot open a session for ~nothing, so a
  // voucher that wipes out whatever it targets needs a human, and saying so here is the only
  // actionable moment. Judged against the amount actually in scope — a code that zeroes the
  // reservation fee is a dead end on that plan even though the total is untouched.
  const pricing = await getPricingSettings()
  const upfrontFee = upfrontAmountForPathway(pricing, enrollment.applicant.pathway)
  const listAmount = Number(enrollment.voucher?.listAmount ?? enrollment.amount)
  const base = voucherBaseAmount(voucher, { listAmount, upfrontFee })
  if (base - voucherDiscountFor(voucher, base) < MINIMUM_CHARGE_AMOUNT) {
    const covered = voucherTargetsUpfront(voucher) ? 'reservation fee' : 'enrollment fee'
    return res.status(422).json({ error: `That voucher covers the entire ${covered}. Please contact the academy to complete your enrollment — online checkout needs a payable balance.` })
  }

  applyVoucherToEnrollment(enrollment, voucher, { upfrontFee })
  await enrollment.save()
  await saveAudit('enrollment.voucher_applied', 'Enrollment', req.params.id, { code: voucher.code, discountAmount: enrollment.voucher.discountAmount })
  res.json(publicEnrollment(enrollment))
}))

router.delete('/api/enrollments/:id/voucher', voucherLimiter, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Vouchers require MongoDB.' })
  const enrollment = await findEnrollment(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  if (!VOUCHER_EDIT_STATUSES.includes(enrollment.status)) return res.status(409).json({ error: 'This enrollment can no longer be changed.' })
  const removed = clearVoucherFromEnrollment(enrollment)
  if (removed) {
    await enrollment.save()
    await saveAudit('enrollment.voucher_removed', 'Enrollment', req.params.id)
  }
  res.json(publicEnrollment(enrollment))
}))

router.post('/api/enrollments/:id/payment-session', asyncRoute(async (req, res) => {
  const enrollment = await findEnrollment(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  if (enrollment.status !== 'payment_pending') return res.status(409).json({ error: 'All signed documents are required before payment.' })

  // The stored voucher is re-checked at the moment checkout opens, never trusted from when it was
  // applied — a code can expire or hit its limit in between. If it no longer holds it is stripped
  // and the request fails loudly, rather than quietly opening checkout at a price the applicant was
  // never shown. The response carries the corrected total so the page can re-render it.
  if (dbState.ready && enrollment.voucher?.voucherId) {
    const live = await Voucher.findById(enrollment.voucher.voucherId)
    const stillValid = voucherRejection(live) ?? await voucherApplicantRejection(live, enrollment.applicant.email)
    if (stillValid) {
      clearVoucherFromEnrollment(enrollment)
      await enrollment.save()
      await saveAudit('enrollment.voucher_expired_at_checkout', 'Enrollment', req.params.id)
      return res.status(409).json({ error: `${stillValid} Your total has been updated — please review it and continue.`, ...publicEnrollment(enrollment) })
    }
  }

  // "upfront" only charges the pathway's reservation fee now — the remaining balance
  // (enrollment.amount - planAmount) is followed up on manually by staff, see payment.plan/
  // planAmount below and AdminEnrollmentsPage's balance column.
  const { plan } = paymentSessionInput.parse(req.body ?? {})
  const resolvedPlan = plan ?? 'full'
  const pricing = await getPricingSettings()
  // The full plan charges `enrollment.amount`, which applyVoucherToEnrollment already made net of
  // any TOTAL-scoped voucher — an UPFRONT-scoped one leaves it at list price on purpose, so paying
  // in full correctly ignores it. upfrontChargeFor applies the reverse split for the other plan.
  // The automatic pay-in-full discount is mutually exclusive with a voucher (a code already reflects
  // whatever deal was agreed) — computed here, but only actually taken off `enrollment.amount` once
  // markEnrollmentPaid confirms the payment, so a cancelled/retried checkout never mutates it.
  const payInFullDiscountAmount = resolvedPlan === 'full' && !enrollment.voucher
    ? payInFullDiscountFor(pricing, enrollment.applicant.pathway, enrollment.amount)
    : 0
  const chargeAmount = resolvedPlan === 'upfront'
    ? upfrontChargeFor(enrollment, upfrontAmountForPathway(pricing, enrollment.applicant.pathway))
    : enrollment.amount - payInFullDiscountAmount
  if (!(chargeAmount >= MINIMUM_CHARGE_AMOUNT)) {
    return res.status(409).json({ error: 'This enrollment has no payable balance left for online checkout. Please contact the academy to finalise it.' })
  }

  if (!config.paymongo.secretKey) {
    enrollment.payment = { provider: 'paymongo-payment-link', checkoutUrl: config.paymongo.paymentLink, referenceNumber: req.params.id, plan: resolvedPlan, planAmount: chargeAmount, payInFullDiscountAmount }
    if (dbState.ready) await enrollment.save()
    return res.json({ checkoutUrl: config.paymongo.paymentLink, mode: 'payment_link_fallback', message: 'The PayMongo payment page is open. Add a PayMongo secret key and webhook to enable automatic payment matching and account email.' })
  }

  const payload = {
    data: {
      attributes: {
        billing: { name: enrollment.applicant.name, email: enrollment.applicant.email, phone: enrollment.applicant.phone },
        line_items: [{ name: resolvedPlan === 'upfront' ? `${catalog.product.name} — upfront fee` : payInFullDiscountAmount > 0 ? `${catalog.product.name} — paid in full` : catalog.product.name, description: `PASS-FIRST enrollment for ${enrollment.applicant.name}`, amount: Math.round(chargeAmount * 100), currency: enrollment.currency, quantity: 1 }],
        payment_method_types: config.paymongo.paymentMethods,
        send_email_receipt: true,
        show_description: true,
        show_line_items: true,
        success_url: paymentReturnUrl('success', req.params.id),
        cancel_url: paymentReturnUrl('cancelled', req.params.id),
        reference_number: req.params.id,
        metadata: { enrollment_id: req.params.id },
      },
    },
  }
  const response = await fetch('https://api.paymongo.com/v2/checkout_sessions', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.paymongo.secretKey}:`).toString('base64')}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `treeacademy-enrollment-${req.params.id}`,
    },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result?.data?.attributes?.checkout_url) {
    console.error('PayMongo checkout-session error', response.status, result)
    return res.status(502).json({ error: 'PayMongo could not start checkout. Please try again shortly.' })
  }
  enrollment.payment = {
    provider: 'paymongo',
    checkoutId: result.data.id,
    checkoutUrl: result.data.attributes.checkout_url,
    referenceNumber: req.params.id,
    plan: resolvedPlan,
    planAmount: chargeAmount,
    payInFullDiscountAmount,
  }
  if (dbState.ready) await enrollment.save()
  await saveAudit('payment.checkout_created', 'Enrollment', req.params.id, { checkoutId: result.data.id, plan: resolvedPlan, planAmount: chargeAmount })
  res.json({ checkoutUrl: result.data.attributes.checkout_url, mode: 'checkout_session' })
}))

// Dev-only: simulate the PayMongo `checkout_session.payment.paid` webhook so the paid → account
// provisioning path can be tested on localhost, where PayMongo cannot reach the real webhook.
// Mirrors the webhook's state effect exactly via the shared markEnrollmentPaid helper. 404s in
// production and whenever DEMO_MODE is off.
router.post('/api/enrollments/:id/demo/mark-paid', asyncRoute(async (req, res) => {
  if (isProduction || !config.demoMode) return res.status(404).end()
  const enrollment = await findEnrollment(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  if (!['payment_pending', 'contract_signed'].includes(enrollment.status)) return res.status(409).json({ error: 'This enrollment is not awaiting payment.' })

  const transactionId = `demo_${id()}`
  const invitation = await markEnrollmentPaid(enrollment, {
    provider: 'paymongo',
    transactionId,
    referenceNumber: enrollment.payment?.referenceNumber ?? req.params.id,
    paidAt: new Date(),
  })
  await saveAudit('payment.demo_paid_auto_approved', 'Enrollment', enrollment._id?.toString() ?? enrollment.id, { transactionId, delivery: invitation?.delivery })
  res.json({ ...publicEnrollment(enrollment), nextStep: 'complete', invitation })
}))

// --- Generic per-course agreements (Course.agreementTemplate) — the no-payment counterpart to the
// pathway enrollment routes above, for courses outside the 3 fixed pathways. Public/unauthenticated,
// same trust model as the /api/enrollments routes: anyone can apply, access is granted the moment
// the agreement is signed since there is no payment gate to wait on. See CourseEnrollment in models.js.
const agreementCourse = async (slug) => {
  const course = await Course.findOne({ slug })
  return course && course.isPublished && courseIsAvailable(course) && course.agreementTemplate?.fileKey ? course : null
}

router.get('/api/course-agreements/:slug', asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Course agreements require MongoDB.' })
  const course = await agreementCourse(req.params.slug)
  if (!course) return res.status(404).json({ error: 'This course is not accepting applications right now.' })
  res.json({ courseId: course.id, title: course.title, fields: course.agreementTemplate.fields })
}))

// Streams the blank template — not sensitive (no applicant data in an empty form), so this is safe
// to serve unauthenticated and cross-origin, the same trust level as the two static pathway
// templates already served from public/enrollment-documents/.
router.get('/api/course-agreements/:slug/template.pdf', asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(404).end()
  const course = await agreementCourse(req.params.slug)
  if (!course) return res.status(404).end()
  res.type('application/pdf')
  res.send(await getFile(course.agreementTemplate.fileKey))
}))

router.post('/api/course-agreements/:slug/apply', asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Course agreements require MongoDB.' })
  const course = await agreementCourse(req.params.slug)
  if (!course) return res.status(404).json({ error: 'This course is not accepting applications right now.' })
  const applicant = courseApplicantInput.parse(req.body)
  const { signatureName, signatureDataUrl, consent } = signatureInput.parse(req.body)
  const values = agreementFieldsInput.parse(req.body.fields) ?? {}
  if (signatureName.localeCompare(applicant.name, undefined, { sensitivity: 'accent' }) !== 0) return res.status(422).json({ error: 'Your typed electronic signature must match your full name.' })
  if (!consent) return res.status(422).json({ error: 'Electronic-signature consent is required.' })

  const templateBytes = await getFile(course.agreementTemplate.fileKey)
  const pdfKey = await createFilledAgreement({ templateBytes, schema: course.agreementTemplate.fields, values, signatureDataUrl, signatureName, title: course.title })
  const email = applicant.email.toLowerCase()
  const courseEnrollment = await CourseEnrollment.create({
    courseId: course._id,
    applicant: { name: applicant.name, email, phone: applicant.phone },
    document: { pdfKey, signedAt: new Date(), signatureName },
  })
  const invitation = await provisionCourseEnrollmentAccess(course, { name: applicant.name, email })
  await saveAudit('course_enrollment.signed', 'CourseEnrollment', courseEnrollment.id, { courseId: course.id })
  res.status(201).json({ status: 'signed', invitation })
}))

router.get('/api/staff/enrollments', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  // Archived enrollments (abandoned/incomplete signups an admin tidied away) are hidden unless
  // explicitly requested with ?archived=only (just archived) or ?archived=all (everything).
  const scope = req.query.archived
  // The stored row carries the whole intake form and the PDF storage keys. The list only renders a
  // summary, so send a summary — raw applicant answers and file keys have no business in a payload
  // this widely fetched. Staff read the full form by opening the document itself.
  // `amountPaid`/`balance` come from the Payment ledger, not from payment.planAmount — a learner can
  // have several payments, and a manually billed one has no embedded payment at all. Without these
  // this page's revenue and outstanding totals would disagree with the Billing page and with what
  // the learner sees on their own statement.
  const summarise = (row, paid = 0) => ({
    _id: String(row._id ?? row.id), applicant: row.applicant, status: row.status, amount: row.amount, currency: row.currency,
    origin: row.origin ?? 'enrollment',
    amountPaid: paid, balance: Math.max(0, Number(row.amount ?? 0) - paid),
    payment: row.payment ? { plan: row.payment.plan, planAmount: row.payment.planAmount, paidAt: row.payment.paidAt, referenceNumber: row.payment.referenceNumber, balanceDueDate: row.payment.balanceDueDate ?? null, balanceNote: row.payment.balanceNote ?? '', installments: (row.payment.installments ?? []).map((line) => ({ amount: line.amount, dueDate: line.dueDate, label: line.label })) } : undefined,
    createdAt: row.createdAt, archivedAt: row.archivedAt ?? null, documents: enrollmentDocuments(row),
  })
  if (dbState.ready) {
    const filter = scope === 'all' ? {} : scope === 'only' ? { archivedAt: { $ne: null } } : { archivedAt: null }
    const rows = await Enrollment.find(filter).sort({ createdAt: -1 }).lean()
    const paid = await paidByEnrollment(rows.map((row) => row._id))
    return res.json(rows.map((row) => summarise(row, paid.get(String(row._id)) ?? 0)))
  }
  const rows = [...memory.enrollments.values()].reverse()
  // Explicit arrow, not `.map(summarise)` — map passes the index as the second argument, which would
  // land in `paid` and report the row's position as the amount collected.
  res.json((scope === 'all' ? rows : rows.filter((row) => (scope === 'only' ? row.archivedAt : !row.archivedAt))).map((row) => summarise(row, 0)))
}))

// Streams a submitted admission form or signed agreement to staff. The file itself lives in private
// object storage and is never reachable by URL — this route is the only way in, and it authorizes
// the caller first. Every view is audited: these are signed legal documents full of personal data,
// so "who looked at this, and when" has to be answerable.
router.get('/api/staff/enrollments/:id/documents/:type', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const spec = ENROLLMENT_DOCUMENT_TYPES[req.params.type]
  if (!spec) return res.status(404).json({ error: 'Unknown enrollment document.' })
  const enrollment = await findEnrollment(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  const key = spec.key(enrollment)
  if (!key) return res.status(404).json({ error: 'That document has not been submitted yet.' })
  await saveAudit('enrollment.document_viewed', 'Enrollment', req.params.id, { type: req.params.type }, req.auth.sub)
  const safeName = (enrollment.applicant?.name ?? 'applicant').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')
  sendPrivateDownload(res, await getFile(key), `${safeName}-${req.params.type}.pdf`, 'application/pdf')
}))

router.post('/api/staff/enrollments/:id/decision', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const body = z.object({ decision: z.enum(['approved', 'rejected', 'refunded']), reason: z.string().trim().max(500).optional() }).parse(req.body)
  const enrollment = dbState.ready ? await Enrollment.findById(req.params.id) : memory.enrollments.get(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  if (!['paid_approval_pending', 'rejected'].includes(enrollment.status)) return res.status(409).json({ error: 'Enrollment cannot be decided in its current state.' })
  enrollment.status = body.decision
  enrollment.decisionReason = body.reason
  enrollment.reviewedAt = new Date()
  let invitation = null
  if (body.decision === 'approved') { invitation = await provisionLearnerAccount(enrollment); await bestEffortEmail(sendPaymentReceiptEmail(enrollment, invitation?.setupUrl), 'payment_receipt email') }
  if (dbState.ready) await enrollment.save()
  await saveAudit(`enrollment.${body.decision}`, 'Enrollment', req.params.id, { reason: body.reason }, req.auth.sub)
  res.json({ ...publicEnrollment(enrollment), invitation })
}))
