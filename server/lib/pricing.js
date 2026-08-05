import { catalog } from '../catalog.js'
import { Payment, PricingSettings } from '../models.js'
import { dbState } from '../state.js'

// Falls back to catalog.js's static price when no admin override has been saved yet (or when
// running without MongoDB), so the enrollment/payment flow always has a price to show.
export async function getPricingSettings() {
  const defaults = { totalBroker: catalog.product.amount, totalConsultant: catalog.product.amount, totalAppraiser: catalog.product.amount, currency: catalog.product.currency, upfrontBroker: 1000, upfrontConsultant: 5000, upfrontAppraiser: 1000 }
  if (!dbState.ready) return defaults
  const saved = await PricingSettings.findOne().lean()
  return saved ? { totalBroker: saved.totalBroker, totalConsultant: saved.totalConsultant, totalAppraiser: saved.totalAppraiser, currency: saved.currency, upfrontBroker: saved.upfrontBroker, upfrontConsultant: saved.upfrontConsultant, upfrontAppraiser: saved.upfrontAppraiser } : defaults
}
const totalAmountKeyByPathway = { broker: 'totalBroker', consultant: 'totalConsultant', appraiser: 'totalAppraiser' }
const upfrontAmountKeyByPathway = { broker: 'upfrontBroker', consultant: 'upfrontConsultant', appraiser: 'upfrontAppraiser' }
export const totalAmountForPathway = (pricing, pathway) => pricing[totalAmountKeyByPathway[pathway]]
export const upfrontAmountForPathway = (pricing, pathway) => pricing[upfrontAmountKeyByPathway[pathway]]

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
