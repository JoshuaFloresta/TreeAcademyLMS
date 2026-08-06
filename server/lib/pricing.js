import { catalog } from '../catalog.js'
import { Payment, PricingSettings } from '../models.js'
import { dbState } from '../state.js'
import { MINIMUM_CHARGE_AMOUNT } from './vouchers.js'

// Falls back to catalog.js's static price when no admin override has been saved yet (or when
// running without MongoDB), so the enrollment/payment flow always has a price to show.
export async function getPricingSettings() {
  const defaults = {
    totalBroker: catalog.product.amount, totalConsultant: catalog.product.amount, totalAppraiser: catalog.product.amount,
    currency: catalog.product.currency,
    upfrontBroker: 1000, upfrontConsultant: 5000, upfrontAppraiser: 1000,
    payInFullDiscountType: 'percent', payInFullDiscountBroker: 0, payInFullDiscountConsultant: 0, payInFullDiscountAppraiser: 0,
    installmentCount: 3, installmentIntervalDays: 30,
  }
  if (!dbState.ready) return defaults
  const saved = await PricingSettings.findOne().lean()
  if (!saved) return defaults
  return {
    totalBroker: saved.totalBroker, totalConsultant: saved.totalConsultant, totalAppraiser: saved.totalAppraiser,
    currency: saved.currency,
    upfrontBroker: saved.upfrontBroker, upfrontConsultant: saved.upfrontConsultant, upfrontAppraiser: saved.upfrontAppraiser,
    // `??` covers a PricingSettings row saved before these fields existed — same convention as
    // enrollment.voucher.appliesTo elsewhere in this codebase.
    payInFullDiscountType: saved.payInFullDiscountType ?? 'percent',
    payInFullDiscountBroker: saved.payInFullDiscountBroker ?? 0,
    payInFullDiscountConsultant: saved.payInFullDiscountConsultant ?? 0,
    payInFullDiscountAppraiser: saved.payInFullDiscountAppraiser ?? 0,
    installmentCount: saved.installmentCount ?? 3,
    installmentIntervalDays: saved.installmentIntervalDays ?? 30,
  }
}
const totalAmountKeyByPathway = { broker: 'totalBroker', consultant: 'totalConsultant', appraiser: 'totalAppraiser' }
const upfrontAmountKeyByPathway = { broker: 'upfrontBroker', consultant: 'upfrontConsultant', appraiser: 'upfrontAppraiser' }
const payInFullDiscountKeyByPathway = { broker: 'payInFullDiscountBroker', consultant: 'payInFullDiscountConsultant', appraiser: 'payInFullDiscountAppraiser' }
export const totalAmountForPathway = (pricing, pathway) => pricing[totalAmountKeyByPathway[pathway]]
export const upfrontAmountForPathway = (pricing, pathway) => pricing[upfrontAmountKeyByPathway[pathway]]

// The automatic "pay in full" discount — no code needed, admin-configured per pathway, and always
// computed off `baseAmount` (the enrollment's current, voucher-adjusted amount) rather than
// recomputed from a stored discount later, so it can never compound across repeated checkout
// attempts. Callers are responsible for passing null/0 when a voucher is already applied (the two
// are mutually exclusive by design — see routes/enrollment.js payment-session).
export function payInFullDiscountFor(pricing, pathway, baseAmount) {
  const value = Number(pricing[payInFullDiscountKeyByPathway[pathway]] ?? 0)
  const base = Number(baseAmount ?? 0)
  if (!(value > 0) || !(base > MINIMUM_CHARGE_AMOUNT)) return 0
  const raw = pricing.payInFullDiscountType === 'fixed' ? value : (base * value) / 100
  // Clamped so a misconfigured 100%+ discount can never leave nothing payable, the same floor
  // voucherRejection enforces for voucher codes.
  return Math.max(0, Math.min(Math.round(raw * 100) / 100, base - MINIMUM_CHARGE_AMOUNT))
}

// Splits a remaining balance into `count` staff-tracked installments, spaced `intervalDays` apart
// starting from `startDate` (payment-confirmation time). Any rounding remainder lands on the last
// installment so the schedule always sums exactly to `balance` — never off by a centavo.
export function buildInstallmentSchedule({ balance, count, intervalDays, startDate = new Date() }) {
  const total = Math.round(Number(balance ?? 0) * 100) / 100
  const installmentCount = Math.max(1, Math.trunc(Number(count ?? 1)))
  const spacing = Math.max(1, Math.trunc(Number(intervalDays ?? 30)))
  if (!(total > 0)) return []
  const per = Math.floor((total / installmentCount) * 100) / 100
  const schedule = []
  let allocated = 0
  for (let index = 0; index < installmentCount; index += 1) {
    const isLast = index === installmentCount - 1
    const amount = isLast ? Math.round((total - allocated) * 100) / 100 : per
    allocated += amount
    const dueDate = new Date(startDate)
    dueDate.setDate(dueDate.getDate() + spacing * (index + 1))
    schedule.push({ amount, dueDate, label: `Installment ${index + 1} of ${installmentCount}` })
  }
  return schedule
}

// Money in, summed from the ledger with voided rows excluded. One implementation so the learner
// statement, the staff list, and the per-enrollment detail can never disagree.
export async function paidByEnrollment(enrollmentIds) {
  const totals = new Map()
  if (!enrollmentIds.length) return totals
  const rows = await Payment.find({ enrollmentId: { $in: enrollmentIds }, voidedAt: null }).select('enrollmentId amount').lean()
  for (const row of rows) {
    const key = String(row.enrollmentId)
    totals.set(key, (totals.get(key) ?? 0) + Number(row.amount ?? 0))
  }
  return totals
}

export const pathwayTitleById = new Map(catalog.pathways.map((pathway) => [pathway.id, pathway.title]))
export const planLabel = { full: 'Full payment', upfront: 'Upfront reservation fee' }
