import { Assignment, Attendance, Badge, BadgeRule, LearningProgress, Module, QuizAttempt, StudentBadge, Submission } from '../models.js'
import { dbState } from '../state.js'
import { saveAudit } from './audit.js'
import { notifyUsers } from './notify.js'

// Whether one learner currently satisfies one rule's condition. Each branch mirrors how that same
// fact is computed elsewhere in the app (course completion matches the auto-certificate check
// below; score comparisons match how the gradebook/quiz review express a percent) so a badge and a
// certificate never disagree about whether a course is "done".
async function badgeRuleSatisfied(rule, learnerId) {
  const { trigger, courseId } = rule
  if (trigger.type === 'course_completion') {
    const [progress, moduleCount] = await Promise.all([
      LearningProgress.findOne({ learnerId, courseId }).select('completedModuleIds').lean(),
      Module.countDocuments({ courseId }),
    ])
    return moduleCount > 0 && (progress?.completedModuleIds?.length ?? 0) >= moduleCount
  }
  if (trigger.type === 'module_milestone') {
    const progress = await LearningProgress.findOne({ learnerId, courseId }).select('completedModuleIds').lean()
    return Boolean(progress?.completedModuleIds?.some((id) => String(id) === String(trigger.moduleId)))
  }
  if (trigger.type === 'score_threshold') {
    if (trigger.targetKind === 'assignment') {
      const [submission, assignment] = await Promise.all([
        Submission.findOne({ assignmentId: trigger.targetId, learnerId }).select('grade').lean(),
        Assignment.findById(trigger.targetId).select('maxPoints').lean(),
      ])
      if (!submission || submission.grade == null || !assignment) return false
      return (submission.grade / (assignment.maxPoints || 100)) * 100 >= trigger.minPercent
    }
    // Quizzes may be attempted more than once; the most recent attempt is what "your score" means
    // everywhere else this app shows it (the Submissions review page, the learner's own history).
    const attempt = await QuizAttempt.findOne({ quizId: trigger.targetId, learnerId }).sort({ submittedAt: -1 }).select('reviewedScore percent total').lean()
    if (!attempt) return false
    const percent = attempt.reviewedScore != null && attempt.total ? (attempt.reviewedScore / attempt.total) * 100 : attempt.percent
    return percent >= trigger.minPercent
  }
  if (trigger.type === 'attendance_count') {
    const count = await Attendance.countDocuments({ courseId, learnerId, status: { $in: ['present', 'late'] } })
    return count >= trigger.minAttendance
  }
  return false
}

// Re-checks every active rule for `courseId` whose trigger could plausibly have just changed
// (`triggerTypes` narrows this — a grade save never needs to re-check attendance rules) against
// `learnerIds`, and awards any badge newly earned. Called inline from the routes that can make a
// trigger true, rather than on a schedule: the app has no background job runner, and re-checking a
// handful of rules for one or two affected learners on a write that already hits the database is
// cheap. Never throws — a badge miscalculation must not fail the grade/attendance/completion write
// that triggered it.
export async function runBadgeRules(courseId, learnerIds, triggerTypes) {
  if (!dbState.ready || !courseId || !learnerIds.length) return
  try {
    const rules = await BadgeRule.find({ courseId, isActive: true, 'trigger.type': { $in: triggerTypes } }).lean()
    for (const rule of rules) {
      const eligible = rule.targetScope === 'selected'
        ? learnerIds.filter((learnerId) => rule.learnerIds?.some((allowed) => String(allowed) === String(learnerId)))
        : learnerIds
      for (const learnerId of eligible) {
        if (await StudentBadge.exists({ badgeId: rule.badgeId, learnerId })) continue // already earned — rules only ever grant once
        if (!(await badgeRuleSatisfied(rule, learnerId))) continue
        const award = await StudentBadge.create({ badgeId: rule.badgeId, learnerId, awardedByRuleId: rule._id })
        await saveAudit('badge.auto_awarded', 'StudentBadge', award.id, { badgeId: String(rule.badgeId), ruleId: String(rule._id), trigger: rule.trigger.type }, null)
        const badge = await Badge.findById(rule.badgeId).select('title').lean()
        await notifyUsers([learnerId], { title: 'New badge earned!', body: `You earned “${badge?.title ?? 'a badge'}”.`, link: '/recognition' })
      }
    }
  } catch (error) {
    console.error('Badge rule evaluation failed:', error)
  }
}
