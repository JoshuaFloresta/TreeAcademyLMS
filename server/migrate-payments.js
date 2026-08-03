// One-off migration: money received used to live in a single embedded `enrollment.payment` object,
// which could only ever hold one transaction. The Payment collection is now the ledger, and
// /api/billing/me sums it instead of inferring "approved means paid in full". This copies each
// existing embedded payment across so no already-collected money disappears from a statement.
//
// Also stamps `origin: 'enrollment'` on rows that predate that field, so a manual billing record
// created later is distinguishable from one that came through the public enrollment flow.
//
// Safe to re-run: an enrollment that already has a ledger row is skipped rather than duplicated.
import mongoose from 'mongoose'
import { config } from './config.js'
import { Enrollment, Payment } from './models.js'

const methodFor = (payment) => (String(payment.provider ?? '').includes('paymongo') ? 'paymongo' : 'other')
const kindFor = (payment) => (payment.plan === 'upfront' ? 'upfront' : payment.plan === 'full' ? 'full' : 'balance')

async function migrate() {
  if (!config.mongoUri) {
    console.error('MONGODB_URI is not set. This migration requires a real database connection.')
    process.exitCode = 1
    return
  }
  await mongoose.connect(config.mongoUri)

  const stamped = await Enrollment.updateMany({ origin: { $exists: false } }, { $set: { origin: 'enrollment' } })
  if (stamped.modifiedCount) console.log(`Stamped origin='enrollment' on ${stamped.modifiedCount} existing enrollment(s).`)

  const paid = await Enrollment.find({ 'payment.paidAt': { $ne: null } }).lean()
  let created = 0
  let skipped = 0

  for (const enrollment of paid) {
    if (await Payment.countDocuments({ enrollmentId: enrollment._id })) { skipped += 1; continue }
    const payment = enrollment.payment ?? {}
    // planAmount is what was actually charged; fall back to the enrollment total for rows written
    // before the plan/planAmount fields existed.
    const amount = Number(payment.planAmount ?? enrollment.amount ?? 0)
    await Payment.create({
      enrollmentId: enrollment._id,
      amount,
      currency: enrollment.currency ?? 'PHP',
      method: methodFor(payment),
      kind: kindFor(payment),
      receivedAt: payment.paidAt,
      reference: payment.transactionId ?? payment.referenceNumber ?? '',
      note: 'Migrated from the enrollment’s embedded payment record.',
    })
    created += 1
    console.log(`   ${enrollment.applicant?.email}  ₱${amount}  (${kindFor(payment)} via ${methodFor(payment)})`)
  }

  console.log(`\nCreated ${created} ledger row(s) from existing payments.`)
  if (skipped) console.log(`${skipped} enrollment(s) already had a ledger row — left untouched.`)

  const unpaid = await Enrollment.countDocuments({ 'payment.paidAt': null })
  console.log(`${unpaid} enrollment(s) have no recorded payment — these now correctly show a full outstanding balance.`)

  await mongoose.disconnect()
}

migrate().catch((error) => {
  console.error('Payment migration failed:', error)
  process.exitCode = 1
})
