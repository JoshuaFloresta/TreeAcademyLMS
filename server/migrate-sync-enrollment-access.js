// One-off migration: synchronizes enrollment records with current course access (LearningProgress).
// Any approved, active enrollment for a learner who no longer has access to that pathway's course
// (e.g. course access was removed by staff in User Management) will have archivedAt set, ensuring
// it is removed from their Statement of Account and active admin billing views.
import mongoose from 'mongoose'
import { config } from './config.js'
import { Course, Enrollment, LearningProgress, User } from './models.js'
import { pathwayForCourseSlug } from './lib/enrollment-shared.js'

async function sync() {
  if (!config.mongoUri) {
    console.error('MONGODB_URI is not set. This migration requires a real database connection.')
    process.exitCode = 1
    return
  }
  await mongoose.connect(config.mongoUri)

  const courses = await Course.find().select('_id slug').lean()
  const courseIdByPathway = new Map()
  for (const c of courses) {
    const p = pathwayForCourseSlug(c.slug)
    if (p) courseIdByPathway.set(p, c._id)
  }

  const approvedEnrollments = await Enrollment.find({ status: 'approved', archivedAt: null }).lean()
  let archivedCount = 0
  let preservedCount = 0

  for (const enrollment of approvedEnrollments) {
    const email = enrollment.applicant?.email?.toLowerCase()
    const learner = await User.findOne({ email }).select('_id').lean()
    const courseId = courseIdByPathway.get(enrollment.applicant?.pathway)

    if (!learner || !courseId) {
      continue
    }

    const hasAccess = await LearningProgress.exists({ learnerId: learner._id, courseId })
    if (!hasAccess) {
      await Enrollment.updateOne({ _id: enrollment._id }, { $set: { archivedAt: new Date() } })
      archivedCount += 1
      console.log(`Archived enrollment for ${email} (${enrollment.applicant?.pathway}) — no active course access found.`)
    } else {
      preservedCount += 1
    }
  }

  console.log(`Sync complete: ${archivedCount} orphaned enrollment(s) archived, ${preservedCount} active enrollment(s) preserved.`)
  await mongoose.disconnect()
}

sync().catch((error) => {
  console.error('Sync failed:', error)
  process.exitCode = 1
})
