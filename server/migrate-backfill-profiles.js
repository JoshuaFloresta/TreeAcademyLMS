// One-off migration: learner profiles now carry birth date, school, and degree, seeded from the
// admission form at provisioning time (see applyIntakeToProfile / provisionLearnerAccount).
// Learners provisioned before this change have those fields empty even though they filled the same
// answers in during enrollment. Run this once against a populated database to copy them across.
//
// Safe to re-run: only blank fields are filled, so a learner who has since edited their own profile
// keeps what they typed.
import mongoose from 'mongoose'
import { config } from './config.js'
import { Enrollment, User } from './models.js'
import { applyIntakeToProfile } from './profile.js'

async function backfill() {
  if (!config.mongoUri) {
    console.error('MONGODB_URI is not set. This migration requires a real database connection.')
    process.exitCode = 1
    return
  }
  await mongoose.connect(config.mongoUri)

  const learners = await User.find({ role: 'learner' }).select('_id email birthDate school degree')
  let updated = 0
  let skippedNoIntake = 0
  let alreadyComplete = 0

  for (const learner of learners) {
    if (learner.birthDate && learner.school && learner.degree) { alreadyComplete += 1; continue }
    // Newest first: if someone enrolled twice, the most recent answers are the current ones.
    const enrollment = await Enrollment.findOne({ 'applicant.email': learner.email, 'intake.data': { $ne: null } }).sort({ createdAt: -1 }).select('intake.data').lean()
    if (!enrollment?.intake?.data) { skippedNoIntake += 1; continue }
    applyIntakeToProfile(learner, enrollment.intake.data)
    if (!learner.isModified()) continue
    await learner.save()
    updated += 1
  }

  console.log(`Backfilled ${updated} learner profile(s).`)
  if (alreadyComplete) console.log(`${alreadyComplete} already had every field set — left untouched.`)
  if (skippedNoIntake) console.log(`${skippedNoIntake} learner(s) had no submitted admission form — likely admin-created accounts.`)
  await mongoose.disconnect()
}

backfill().catch((error) => {
  console.error('Backfill failed:', error)
  process.exitCode = 1
})
