import { MessageCircle, ShieldCheck, Sparkles } from 'lucide-react'

export const pathways = [
  {
    id: 'broker',
    kicker: 'For licensed professionals',
    title: 'Broker Review',
    copy: 'Refine high-stakes judgement, industry ethics, and confident market leadership.',
    details: 'Build a bulletproof foundation for your brokerage career. This program equips you with the legal knowledge, ethical standards, and operational practices needed to pass the Broker board exam on your first try.',
    examTag: 'REBLEx',
    duration: '12 weeks',
    features: ['Complete board-exam coverage', 'Practical case discussions'],
    price: '₱10,000',
    upfrontFee: '₱1,000 upfront fee',
    icon: ShieldCheck,
    tone: 'forest',
  },
  {
    id: 'consultant',
    kicker: 'For trusted advisors',
    title: 'Consultant Review',
    copy: 'Turn complex market thinking into informed, client-ready conversations.',
    details: 'A comprehensive 12-week review program for the Real Estate Consultant licensure exam. Deep-dive into high-level advisory practices, market research, financial modeling, risk sensitivity testing, and Project Feasibility Studies.',
    examTag: 'RECLEx',
    duration: '12 weeks',
    features: ['Strategic consultant training', 'Feasibility-study case practice'],
    price: '₱25,000',
    upfrontFee: '₱5,000 upfront fee',
    icon: MessageCircle,
    tone: 'paper',
  },
  {
    id: 'appraiser',
    kicker: 'For rising practitioners',
    title: 'Appraiser Review',
    copy: 'Develop reliable property practice with guidance you can apply immediately.',
    details: 'Master the science of property practice with hands-on guidance, market analysis, and real-world case discussions that prepare you for confident, ethical client service.',
    examTag: 'REALEx',
    duration: '12 weeks',
    features: ['Expert-led practice coaching', 'Mock exams and final coaching'],
    price: '₱10,000',
    upfrontFee: '₱1,000 upfront fee',
    icon: Sparkles,
    tone: 'gold',
  },
]

// The `price`/`upfrontFee` strings above are fallback copy only. PricingSettings (admin-edited, and
// what checkout actually charges) is the source of truth, so whenever /api/pricing loads it wins —
// otherwise the landing page can silently advertise a figure the checkout no longer honours, which
// is exactly what happened when broker/appraiser drifted to half their real price.
export const totalKeyByPathway = { broker: 'totalBroker', consultant: 'totalConsultant', appraiser: 'totalAppraiser' }
export const upfrontKeyByPathway = { broker: 'upfrontBroker', consultant: 'upfrontConsultant', appraiser: 'upfrontAppraiser' }
export const payInFullDiscountKeyByPathway = { broker: 'payInFullDiscountBroker', consultant: 'payInFullDiscountConsultant', appraiser: 'payInFullDiscountAppraiser' }
export const peso = (value) => `₱${Number(value).toLocaleString('en-PH')}`

// Client-side preview only — mirrors payInFullDiscountFor in server/lib/pricing.js so the payment
// step can show the discounted price before checkout, but the server always recomputes and enforces
// this independently at /payment-session; nothing here is ever trusted as the real charge amount.
export const payInFullDiscountPreview = (pricing, pathwayId, baseAmount) => {
  const value = Number(pricing?.[payInFullDiscountKeyByPathway[pathwayId]] ?? 0)
  const base = Number(baseAmount ?? 0)
  if (!(value > 0) || !(base > 0)) return 0
  const raw = pricing?.payInFullDiscountType === 'fixed' ? value : (base * value) / 100
  return Math.max(0, Math.min(Math.round(raw * 100) / 100, base))
}
export const pathwayPricing = (pathway, pricing) => {
  const total = Number(pricing?.[totalKeyByPathway[pathway.id]])
  const upfront = Number(pricing?.[upfrontKeyByPathway[pathway.id]])
  const hasLiveTotal = Number.isFinite(total) && total > 0
  // Only meaningful once live pricing has loaded — the static fallback copy in `pathways` above has
  // no discount concept, so a discount never shows against it.
  const discount = hasLiveTotal ? payInFullDiscountPreview(pricing, pathway.id, total) : 0
  return {
    price: hasLiveTotal ? peso(total) : pathway.price,
    upfrontFee: Number.isFinite(upfront) && upfront > 0 ? `${peso(upfront)} upfront fee` : pathway.upfrontFee,
    // Set only when a pay-in-full discount is actually configured for this pathway — callers show
    // the crossed-out `price` above this figure when present, plain `price` otherwise.
    discountedPrice: discount > 0 ? peso(total - discount) : null,
    discountAmount: discount > 0 ? peso(discount) : null,
  }
}

// Shared between the landing page's program modal and the enrollment page's own direct-link
// safety net (someone can land on /enroll?pathway=x from a bookmark or old link without ever
// seeing the modal) — the server is the actual gate (POST /api/enrollments), this just explains it.
export const blockedPathwayMessage = (stats) => {
  if (!stats) return ''
  if (stats.closed) return 'Enrollment for this program is currently closed.'
  if (stats.opensLater) return `Enrollment opens ${new Date(stats.availableFrom).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`
  return ''
}

export const tasks = [
  { title: 'Property valuation practice set', course: 'Broker Review', due: 'Due tomorrow', state: 'late' },
  { title: 'Client consultation reflection', course: 'Consultant Review', due: 'Due Fri, 26 Jul', state: 'soon' },
  { title: 'Agency disclosure worksheet', course: 'Appraiser Review', due: 'Submitted', state: 'done' },
]

export const faq = [
  ['Will I have lifetime access to the course materials and community, or does access expire?', 'Yes, you will receive full lifetime access! Once you enroll, you can revisit the course materials, resource libraries, and community spaces whenever you like, allowing you to learn at your own pace.'],
  ['Are the live group sessions recorded if I cannot make the scheduled time?', 'Yes, all live sessions are fully recorded. If you have a scheduling conflict or miss a live class, the recordings are uploaded directly to the learning platform shortly after each session so you can easily catch up.'],
  ['How much time do I need to commit each week?', `The review schedule may be adjusted depending on the official PRC examination timetable.

Current regular schedule:

RECLEX: Every Thursday and Friday, 6:00 PM–9:00 PM — 6 hours per week
REBLEX: Every Saturday, 6:00 PM–9:00 PM — 3 hours per week
REALEX: Every Saturday, 6:00 PM–9:00 PM — 3 hours per week

Participants will be informed in advance of any schedule changes.`],
  ['Is the course fully online or are there in-person components?', 'The program is 100% online, allowing you to attend live sessions and access all learning materials comfortably from anywhere.'],
  ['What credentials or certificate do I receive upon completion?', 'Upon successfully completing the program, you will receive an official Certificate of Completion to showcase your achievement and new skills.'],
  ['What is the refund policy?', 'Please note that all sales are final, and we do not offer refunds once enrollment is confirmed. We encourage you to review the course details thoroughly before registering.'],
  ['Can I pay in installments?', 'Yes! In addition to our standard upfront full payment option, we offer flexible installment plans to help break up the cost into manageable payments.'],
]