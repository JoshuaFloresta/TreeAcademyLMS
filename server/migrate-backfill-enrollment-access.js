// One-off migration: catalog visibility used to be all-access (every active learner saw every
// published course). It's now gated to the pathway on the learner's approved enrollment, granted
// via a LearningProgress row created at approval time (see provisionLearnerAccount in index.js).
// Existing learners provisioned before this change won't have that row yet — run this once so
// they don't lose access to a course they already paid for.
import mongoose from 'mongoose'
import { config } from './config.js'
import { Course, Enrollment, LearningProgress, User } from './models.js'

async function backfill() {
  if (!config.mongoUri) {
    console.error('MONGODB_URI is not set. This migration requires a real database connection.')
    process.exitCode = 1
    return
  }
  await mongoose.connect(config.mongoUri)

  const courses = await Course.find().select('_id slug').lean()
  const courseByPathway = new Map(courses.map((course) => [course.slug.replace(/-review$/, ''), course._id]))

  const learners = await User.find({ role: 'learner', status: 'active' }).select('_id email').lean()
  let granted = 0
  let skippedNoEnrollment = 0

  for (const learner of learners) {
    const existing = await LearningProgress.exists({ learnerId: learner._id })
    if (existing) continue // already has course access recorded

    const approvedEnrollments = await Enrollment.find({ 'applicant.email': learner.email, status: 'approved' }).select('applicant.pathway').lean()
    if (!approvedEnrollments.length) { skippedNoEnrollment += 1; continue }

    for (const enrollment of approvedEnrollments) {
      const courseId = courseByPathway.get(enrollment.applicant.pathway)
      if (!courseId) continue
      await LearningProgress.findOneAndUpdate(
        { learnerId: learner._id, courseId }, { $setOnInsert: { completedModuleIds: [] } }, { upsert: true, setDefaultsOnInsert: true })
      granted += 1
    }
  }

  console.log(`Granted course access for ${granted} learner/course pair(s).`)
  if (skippedNoEnrollment) console.log(`${skippedNoEnrollment} active learner(s) had no matching approved enrollment — check them manually (e.g. admin-created accounts).`)
  await mongoose.disconnect()
}

backfill().catch((error) => {
  console.error('Backfill failed:', error)
  process.exitCode = 1
})
