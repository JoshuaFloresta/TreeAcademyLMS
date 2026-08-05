import { Course, LearningProgress } from '../models.js'

// Seasonal availability — published courses are only visible to learners/public inside their window.
export const learnerCourseFilter = () => {
  const now = new Date()
  return {
    isPublished: true,
    $and: [
      { $or: [{ availableFrom: { $exists: false } }, { availableFrom: null }, { availableFrom: { $lte: now } }] },
      { $or: [{ availableUntil: { $exists: false } }, { availableUntil: null }, { availableUntil: { $gte: now } }] },
    ],
  }
}
export const courseIsAvailable = (course) => {
  const now = Date.now()
  if (course.availableFrom && new Date(course.availableFrom).getTime() > now) return false
  if (course.availableUntil && new Date(course.availableUntil).getTime() < now) return false
  return true
}
// Same "is this pathway open" definition the public pathway-stats card uses (isPublished, not
// archived, inside its availability window) — reused server-side to actually block a new
// enrollment for a pathway the landing page shows as "Opens <date>" or "Enrollment closed",
// not just hide the CTA client-side.
export const pathwayCourseIsOpen = (course) => Boolean(course && course.isPublished && !course.archivedAt && courseIsAvailable(course))
// A learner only sees the course tied to the pathway on their approved enrollment — granted via a
// LearningProgress row created at approval time (see provisionLearnerAccount) — not every course.
export async function learnerVisibleCourseFilter(learnerId) {
  const rows = await LearningProgress.find({ learnerId }).select('courseId').lean()
  return { ...learnerCourseFilter(), _id: { $in: rows.map((row) => row.courseId) } }
}
export async function visibleCourses(role, learnerId) {
  const isStaff = ['instructor', 'admin'].includes(role)
  return Course.find(isStaff ? {} : await learnerVisibleCourseFilter(learnerId)).select('_id title').lean()
}
