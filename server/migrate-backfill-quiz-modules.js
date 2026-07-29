// One-off migration: quizzes used to be course-scoped only (no moduleId), rendered in a flat
// list separate from any phase. The course builder now renders quizzes inline in their phase's
// Sections list, so pre-existing quizzes without a moduleId would otherwise be stranded in the
// builder's "not yet filed under a phase" fallback. This files each one under its course's first
// phase, appended after that phase's existing sections, so it shows up in the unified list.
import mongoose from 'mongoose'
import { config } from './config.js'
import { Module, Quiz } from './models.js'

async function backfill() {
  if (!config.mongoUri) {
    console.error('MONGODB_URI is not set. This migration requires a real database connection.')
    process.exitCode = 1
    return
  }
  await mongoose.connect(config.mongoUri)

  const orphanQuizzes = await Quiz.find({ $or: [{ moduleId: { $exists: false } }, { moduleId: null }] }).select('_id courseId').lean()
  let filed = 0
  let skippedNoPhase = 0

  for (const quiz of orphanQuizzes) {
    const firstModule = await Module.findOne({ courseId: quiz.courseId }).sort({ position: 1 }).select('_id').lean()
    if (!firstModule) { skippedNoPhase += 1; continue }
    const [lessonCount, assignmentCount, quizCount] = await Promise.all([
      mongoose.model('Lesson').countDocuments({ moduleId: firstModule._id }),
      mongoose.model('Assignment').countDocuments({ moduleId: firstModule._id, lessonId: null }),
      Quiz.countDocuments({ moduleId: firstModule._id }),
    ])
    await Quiz.updateOne({ _id: quiz._id }, { moduleId: firstModule._id, position: lessonCount + assignmentCount + quizCount })
    filed += 1
  }

  console.log(`Filed ${filed} quiz(zes) under their course's first phase.`)
  if (skippedNoPhase) console.log(`${skippedNoPhase} quiz(zes) skipped — their course has no phases yet. Add one, then re-run.`)
  await mongoose.disconnect()
}

backfill().catch((error) => {
  console.error('Backfill failed:', error)
  process.exitCode = 1
})
