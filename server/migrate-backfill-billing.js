// One-off migration: learners onboarded manually (created straight as User rows, never through the
// public enrollment flow) had no Enrollment, so their Statement of Account was completely empty.
// This gives each one a billing record per pathway they actually have course access to, plus a
// payment row for that pathway's upfront fee.
//
// The upfront payment is an ASSUMPTION agreed with the academy: every manually onboarded learner has
// paid at least the upfront fee. The real method and date were never recorded, so the row is dated
// from the learner's account creation and carries a note saying so — correct it in the admin billing
// screen when the true figures are known.
//
// Safe to re-run: a learner who already has an enrollment for a pathway is skipped, never duplicated.
import mongoose from 'mongoose'
import { config } from './config.js'
import { Course, Enrollment, LearningProgress, Payment, PricingSettings, User } from './models.js'
import { catalog } from './catalog.js'

const pathwayBySlug = { 'broker-review': 'broker', 'consultant-review': 'consultant', 'appraiser-review': 'appraiser' }
const totalKey = { broker: 'totalBroker', consultant: 'totalConsultant', appraiser: 'totalAppraiser' }
const upfrontKey = { broker: 'upfrontBroker', consultant: 'upfrontConsultant', appraiser: 'upfrontAppraiser' }

async function backfill() {
  if (!config.mongoUri) {
    console.error('MONGODB_URI is not set. This migration requires a real database connection.')
    process.exitCode = 1
    return
  }
  await mongoose.connect(config.mongoUri)

  const pricing = (await PricingSettings.findOne({}).lean()) ?? {
    totalBroker: catalog.product.amount, totalConsultant: catalog.product.amount, totalAppraiser: catalog.product.amount,
    upfrontBroker: 1000, upfrontConsultant: 5000, upfrontAppraiser: 1000, currency: 'PHP',
  }

  const learners = await User.find({ role: 'learner' }).select('_id name email phone createdAt').lean()
  const courses = await Course.find({}).select('_id slug').lean()
  const slugById = new Map(courses.map((course) => [String(course._id), course.slug]))

  let createdRecords = 0
  let createdPayments = 0
  let skipped = 0
  let noPathway = 0

  for (const learner of learners) {
    const progress = await LearningProgress.find({ learnerId: learner._id }).select('courseId').lean()
    const pathways = [...new Set(progress.map((row) => pathwayBySlug[slugById.get(String(row.courseId))]).filter(Boolean))]
    if (!pathways.length) { noPathway += 1; continue }

    for (const pathway of pathways) {
      if (await Enrollment.countDocuments({ 'applicant.email': learner.email, 'applicant.pathway': pathway, archivedAt: null })) { skipped += 1; continue }

      const amount = Number(pricing[totalKey[pathway]] ?? 0)
      const upfront = Number(pricing[upfrontKey[pathway]] ?? 0)
      const enrollment = await Enrollment.create({
        applicant: { name: learner.name, email: learner.email, phone: learner.phone, pathway },
        amount,
        currency: pricing.currency ?? 'PHP',
        status: 'approved',
        origin: 'manual',
        decisionReason: 'Billing record backfilled for a manually onboarded learner.',
        reviewedAt: new Date(),
      })
      createdRecords += 1

      if (upfront > 0) {
        await Payment.create({
          enrollmentId: enrollment._id,
          amount: upfront,
          currency: pricing.currency ?? 'PHP',
          method: 'other',
          kind: 'upfront',
          receivedAt: learner.createdAt ?? new Date(),
          note: 'Backfilled: upfront fee assumed paid. Actual method and date were not recorded — correct this row if the real figures differ.',
        })
        createdPayments += 1
      }
      console.log(`   ${learner.name} — ${pathway}: total ₱${amount}, upfront ₱${upfront}, balance ₱${amount - upfront}`)
    }
  }

  console.log(`\nCreated ${createdRecords} billing record(s) and ${createdPayments} upfront payment row(s).`)
  if (skipped) console.log(`${skipped} learner/pathway pair(s) already had a record — left untouched.`)
  if (noPathway) console.log(`${noPathway} learner(s) had no pathway course access — nothing to bill, skipped.`)

  await mongoose.disconnect()
}

backfill().catch((error) => {
  console.error('Billing backfill failed:', error)
  process.exitCode = 1
})
