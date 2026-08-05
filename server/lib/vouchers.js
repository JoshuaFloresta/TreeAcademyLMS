import { z } from 'zod'
import { Voucher, VoucherRedemption } from '../models.js'
import { dbState } from '../state.js'
import { httpError } from './http.js'
import { saveAudit } from './audit.js'

// Voucher codes are typed by hand, so they're trimmed and uppercased on the way in and stored
// uppercase — the lookup is then an exact indexed match rather than a case-insensitive scan.
export const voucherCodeField = z.string().trim().toUpperCase()
  .min(3, 'Enter a voucher code.')
  .max(40, 'That voucher code is too long.')
  .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'Voucher codes use letters, numbers, and dashes only.')
export const voucherRedeemInput = z.object({ code: voucherCodeField })
const voucherShape = z.object({
  code: voucherCodeField,
  discountType: z.enum(['percent', 'fixed']),
  discountValue: z.coerce.number().positive('Enter a discount greater than zero.').max(1_000_000),
  // Defaults to 'total' so a voucher created before this existed (or by a caller that omits it)
  // keeps behaving as a straightforward discount on the enrollment price.
  appliesTo: z.enum(['total', 'upfront']).optional(),
  // Null is "never expires"; 0 max uses is "unlimited".
  expiresAt: z.coerce.date().nullable().optional(),
  maxUses: z.coerce.number().int().min(0).max(100_000).optional(),
  maxUsesPerApplicant: z.coerce.number().int().min(0).max(1_000).optional(),
  isActive: z.boolean().optional(),
})
export const voucherInput = voucherShape
// Every field optional so an admin can flip `isActive` or push an expiry date without re-sending
// the whole voucher. The percent ceiling is checked at the route instead of here, because a patch
// that changes only one of the two fields still has to be judged against the stored other one.
export const voucherPatchInput = voucherShape.partial()

// PayMongo rejects a checkout session below its own floor, so a discount that takes the payable
// total under this has to be refused with an explanation rather than sent to the provider to fail.
export const MINIMUM_CHARGE_AMOUNT = 20
// A voucher can only be applied while the enrollment is still pre-payment. Once it's paid the
// amount is what was actually charged, and a discount applied after the fact would silently
// contradict the receipt and the ledger.
export const VOUCHER_EDIT_STATUSES = ['application_pending', 'documents_pending', 'documents_complete', 'payment_pending', 'contract_pending', 'contract_signed']

// Every reason a voucher can be refused, in one place — the redeem route and the re-check at
// checkout have to agree, or a code accepted on the payment step could still be honoured minutes
// after it expired. An unknown code and a deactivated one deliberately return the SAME message:
// this is a public, unauthenticated endpoint, and distinct errors would turn it into an oracle for
// which codes exist.
export function voucherRejection(voucher, now = new Date()) {
  if (!voucher || !voucher.isActive) return 'That voucher code is not valid.'
  if (voucher.expiresAt && new Date(voucher.expiresAt).getTime() <= now.getTime()) return 'That voucher has expired.'
  if (voucher.maxUses > 0 && voucher.usedCount >= voucher.maxUses) return 'That voucher has already reached its usage limit.'
  return null
}

// Rounded to whole pesos here rather than left to PayMongo's centavo conversion, so the figure the
// applicant is shown is exactly the figure that gets charged. Never negative, and never more than
// the price itself — a ₱5,000 fixed voucher against a ₱3,000 enrollment discounts ₱3,000.
export function voucherDiscountFor(voucher, amount) {
  const raw = voucher.discountType === 'percent' ? (Number(amount) * Number(voucher.discountValue)) / 100 : Number(voucher.discountValue)
  return Math.min(Number(amount), Math.max(0, Math.round(raw)))
}

const voucherDiscountLabel = (voucher) => (voucher.discountType === 'percent' ? `${voucher.discountValue}% off` : `₱${Number(voucher.discountValue).toLocaleString('en-PH')} off`)
// Which figure a voucher's discount comes off. 'upfront' targets the reservation fee due today;
// anything else (including a pre-scope voucher with the field missing) targets the total.
export const voucherTargetsUpfront = (voucher) => voucher?.appliesTo === 'upfront'
export const voucherBaseAmount = (voucher, { listAmount, upfrontFee }) => (voucherTargetsUpfront(voucher) ? upfrontFee : listAmount)

// Writes a TOTAL-scoped discount into the existing billing shape instead of inventing a parallel
// one: `amount` becomes the net payable and `feeBreakdown` itemises how it got there, which is the
// contract assertBreakdownTotals already enforces.
//
// An UPFRONT-scoped voucher deliberately leaves both alone. It doesn't change what is owed, only
// what is collected today, so the total, the fee breakdown and the ledger must all stay at list
// price — the saving shows up as a larger remaining balance, which is exactly what it is.
//
// `listAmount` is captured once either way, so applying a second code (or removing one) recomputes
// from the undiscounted price rather than stacking discounts on top of each other.
export function applyVoucherToEnrollment(enrollment, voucher, { upfrontFee }) {
  const listAmount = Number(enrollment.voucher?.listAmount ?? enrollment.amount)
  const baseAmount = voucherBaseAmount(voucher, { listAmount, upfrontFee })
  const discountAmount = voucherDiscountFor(voucher, baseAmount)
  enrollment.voucher = {
    voucherId: voucher._id ?? voucher.id,
    code: voucher.code,
    discountType: voucher.discountType,
    discountValue: voucher.discountValue,
    appliesTo: voucherTargetsUpfront(voucher) ? 'upfront' : 'total',
    discountAmount,
    baseAmount,
    listAmount,
    appliedAt: new Date(),
  }
  if (voucherTargetsUpfront(voucher)) {
    enrollment.amount = listAmount
    enrollment.feeBreakdown = []
  } else {
    enrollment.amount = listAmount - discountAmount
    enrollment.feeBreakdown = [
      { label: 'Enrollment fee', amount: listAmount },
      { label: `Voucher ${voucher.code} (${voucherDiscountLabel(voucher)})`, amount: -discountAmount },
    ]
  }
  return enrollment.voucher
}

// What the reservation-fee plan actually charges. Capped at the enrollment total, since a discounted
// total can land below the pathway's fee — and reduced by an upfront-scoped voucher, using the
// discount SNAPSHOT rather than recomputing, so an admin editing the fee later can't change what an
// applicant was already quoted.
export function upfrontChargeFor(enrollment, pathwayUpfrontFee) {
  const fee = Math.min(Number(pathwayUpfrontFee), Number(enrollment.amount))
  if (!voucherTargetsUpfront(enrollment.voucher)) return fee
  return Math.max(0, fee - Number(enrollment.voucher.discountAmount ?? 0))
}

export function clearVoucherFromEnrollment(enrollment) {
  if (!enrollment.voucher?.code) return false
  enrollment.amount = Number(enrollment.voucher.listAmount ?? enrollment.amount)
  enrollment.voucher = null
  enrollment.feeBreakdown = []
  return true
}

// How many times this specific person has already redeemed this code. Counted by email across all
// their enrollments, since one applicant can hold several (a second pathway, or a restarted
// application) and a per-person cap that only looked at one of them wouldn't be a cap at all.
const applicantRedemptionCount = (voucherId, email) => VoucherRedemption.countDocuments({ voucherId, applicantEmail: String(email).toLowerCase() })

// The per-applicant half of the limit check. Async and applicant-specific, so it can't live inside
// voucherRejection — but the two are always called together, at apply time and again at checkout.
// Unlike voucherRejection this message is deliberately specific: it describes the caller's OWN
// history, so it gives away nothing about which codes exist.
export async function voucherApplicantRejection(voucher, email) {
  const limit = Number(voucher?.maxUsesPerApplicant ?? 0)
  if (!limit || !email) return null
  const used = await applicantRedemptionCount(voucher._id ?? voucher.id, email)
  if (used < limit) return null
  return limit === 1
    ? 'You have already used this voucher.'
    : `You have already used this voucher the maximum of ${limit} times.`
}

// A use is counted when money is actually confirmed, not when a code is applied — otherwise an
// abandoned checkout would burn a use of a limited-run code and nobody could get it back.
//
// The LOG ROW is written first, and its unique (voucherId, enrollmentId) index is what makes the
// whole claim idempotent: a replayed webhook collides, returns early, and the counter is never
// touched a second time. The counter is then bumped with a conditional $inc, which is what makes
// two different applicants racing for the last use safe — only one update matches.
//
// Never throws: a miscounted voucher must not fail the payment that triggered it.
export async function claimVoucherUse(enrollment, learner) {
  const voucher = enrollment.voucher
  const voucherId = voucher?.voucherId
  if (!dbState.ready || !voucherId) return
  const enrollmentId = enrollment._id?.toString() ?? enrollment.id
  try {
    await VoucherRedemption.create({
      voucherId,
      code: voucher.code,
      enrollmentId,
      userId: learner?._id ?? null,
      applicantEmail: enrollment.applicant.email,
      applicantName: enrollment.applicant.name,
      pathway: enrollment.applicant.pathway,
      appliesTo: voucher.appliesTo ?? 'total',
      discountAmount: voucher.discountAmount,
      amountCharged: enrollment.payment?.planAmount ?? enrollment.amount,
      redeemedAt: enrollment.payment?.paidAt ?? new Date(),
    })
  } catch (error) {
    // 11000 = this enrollment is already on the record. A duplicate delivery, not a new redemption.
    if (error?.code === 11000) return
    console.error('voucher redemption log failed:', error.message)
    return
  }
  try {
    const claimed = await Voucher.findOneAndUpdate(
      { _id: voucherId, $or: [{ maxUses: 0 }, { $expr: { $lt: ['$usedCount', '$maxUses'] } }] },
      { $inc: { usedCount: 1 } },
      { new: true },
    )
    // Went over its limit between checkout and payment confirmation. The money is already
    // collected and the redemption is already logged, so this is surfaced for staff rather than
    // reversed — the log row is the truth, the counter is only the guard.
    if (!claimed) await saveAudit('voucher.redeemed_over_limit', 'Enrollment', enrollmentId, { code: voucher.code, email: enrollment.applicant.email })
    else await saveAudit('voucher.redeemed', 'Voucher', claimed.id, { code: claimed.code, usedCount: claimed.usedCount, enrollmentId })
  } catch (error) {
    console.error('voucher redemption count failed:', error.message)
  }
}

// --- Voucher administration (used by routes/admin-vouchers.js) ---------------------------------
export const publicVoucher = (voucher) => ({
  id: voucher._id?.toString() ?? voucher.id,
  code: voucher.code,
  discountType: voucher.discountType,
  discountValue: voucher.discountValue,
  // Missing on any voucher created before the scope toggle existed — those are plain total
  // discounts, which is what the schema default says too.
  appliesTo: voucher.appliesTo ?? 'total',
  expiresAt: voucher.expiresAt ?? null,
  maxUses: voucher.maxUses ?? 0,
  maxUsesPerApplicant: voucher.maxUsesPerApplicant ?? 0,
  usedCount: voucher.usedCount ?? 0,
  isActive: voucher.isActive,
  // Precomputed so the list can show *why* a code stopped working without every row re-deriving
  // the same three checks — and so it matches exactly what an applicant would be told.
  rejection: voucherRejection(voucher),
  createdAt: voucher.createdAt,
})
// A percentage over 100 would discount more than the price. Checked here rather than in the zod
// schema because a PATCH may change only one of the two fields, and the pair still has to be judged
// together against whatever is already stored.
export const assertVoucherValueInRange = (discountType, discountValue) => {
  if (discountType === 'percent' && Number(discountValue) > 100) throw httpError(422, 'A percentage discount cannot exceed 100%.')
}
