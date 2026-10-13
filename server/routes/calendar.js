import express from 'express'
import { z } from 'zod'
import { Attendance, CalendarEvent, Course, LearningProgress, User } from '../models.js'
import { requireAuth, requireStaff } from '../security.js'
import { dbState } from '../state.js'
import { asyncRoute } from '../lib/http.js'
import { saveAudit } from '../lib/audit.js'
import { blankToNull } from '../lib/zod-helpers.js'
import { runBadgeRules } from '../lib/badge-rules.js'

export const router = express.Router()

const calendarEventInput = z.object({
  title: z.string().trim().min(2).max(160),
  description: blankToNull(z.string().trim().max(2000)),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullable().optional(),
  eventType: z.enum(['live_review', 'deadline', 'announcement', 'office_hours']).optional(),
  // Nullable so clearing the field removes the course link rather than being ignored as "absent".
  courseId: blankToNull(z.string().trim().min(1)),
  // Restricted to http(s): this renders as a button learners are told to click, so it must not be
  // able to carry a `javascript:` or `data:` URL into the page.
  meetingUrl: blankToNull(z.string().trim().max(500).refine((value) => /^https?:\/\//i.test(value), 'Enter a full link starting with https://')),
})
const calendarEventUpdateInput = calendarEventInput.partial()
const attendanceRecordInput = z.object({
  learnerId: z.string().trim().min(1),
  status: z.enum(['present', 'absent', 'excused', 'late']),
  remarks: z.string().trim().max(500).optional().nullable(),
})
const attendanceInput = z.object({
  records: z.array(attendanceRecordInput).min(1).max(500),
})

router.get('/api/calendar', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Calendar requires MongoDB.' })
  const filter = {}
  if (req.query.type) filter.eventType = req.query.type
  const events = await CalendarEvent.find(filter).sort({ startsAt: 1 }).lean()
  const courses = await Course.find({ _id: { $in: events.map((event) => event.courseId).filter(Boolean) } }).select('title').lean()
  const titleById = new Map(courses.map((course) => [String(course._id), course.title]))
  res.json(events.map((event) => ({ ...event, courseTitle: event.courseId ? (titleById.get(String(event.courseId)) ?? null) : null })))
}))

router.post('/api/staff/calendar-events', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Calendar requires MongoDB.' })
  const event = await CalendarEvent.create(calendarEventInput.parse(req.body))
  await saveAudit('calendar_event.created', 'CalendarEvent', event.id, {}, req.auth.sub)
  res.status(201).json(event)
}))

// A recurring session's details drift — the Zoom link is regenerated, the topic changes, it moves
// an hour. Without these an instructor could only ever add events, never correct one.
router.patch('/api/staff/calendar-events/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Calendar requires MongoDB.' })
  const updates = calendarEventUpdateInput.parse(req.body)
  const event = await CalendarEvent.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true })
  if (!event) return res.status(404).json({ error: 'Event not found.' })
  await saveAudit('calendar_event.updated', 'CalendarEvent', event.id, { fields: Object.keys(updates) }, req.auth.sub)
  res.json(event)
}))

router.delete('/api/staff/calendar-events/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Calendar requires MongoDB.' })
  const event = await CalendarEvent.findById(req.params.id)
  if (!event) return res.status(404).json({ error: 'Event not found.' })
  // Attendance rows are meaningless once their session is gone — leaving them orphans the roll-call.
  await Promise.all([Attendance.deleteMany({ eventId: event._id }), event.deleteOne()])
  await saveAudit('calendar_event.deleted', 'CalendarEvent', req.params.id, { title: event.title }, req.auth.sub)
  res.status(204).end()
}))

// Built-in attendance — a roll-call roster per calendar session, restricted to events tied to a
// course (attendance needs a learner list to check off, which only a course enrollment gives us).
router.get('/api/staff/calendar-events/:id/attendance', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Attendance requires MongoDB.' })
  const event = await CalendarEvent.findById(req.params.id).lean()
  if (!event) return res.status(404).json({ error: 'Event not found.' })
  if (!event.courseId) return res.status(400).json({ error: 'This event is not linked to a course, so it has no roster to take attendance for.' })
  const progresses = await LearningProgress.find({ courseId: event.courseId }).select('learnerId').lean()
  const records = await Attendance.find({ eventId: event._id }).lean()
  const learnerIdSet = new Set([
    ...progresses.map((progress) => String(progress.learnerId)),
    ...records.map((record) => String(record.learnerId)),
  ])
  const learners = await User.find({ _id: { $in: Array.from(learnerIdSet) } }).select('name email avatarUrl').sort({ name: 1 }).lean()
  const byLearner = new Map(records.map((record) => [String(record.learnerId), record]))
  const markedTimes = records.map((record) => record.markedAt).filter(Boolean).map((value) => new Date(value).getTime())
  res.json({
    event: {
      id: event._id.toString(),
      title: event.title,
      description: event.description ?? null,
      meetingUrl: event.meetingUrl ?? null,
      eventType: event.eventType ?? 'live_review',
      startsAt: event.startsAt,
      endsAt: event.endsAt ?? null,
      courseId: String(event.courseId),
    },
    recordedAt: markedTimes.length ? new Date(Math.max(...markedTimes)) : null,
    roster: learners.map((learner) => {
      const record = byLearner.get(String(learner._id))
      return {
        learnerId: learner._id.toString(),
        name: learner.name,
        email: learner.email,
        avatarUrl: learner.avatarUrl ?? null,
        status: record?.status ?? null,
        remarks: record?.remarks ?? '',
        markedAt: record?.markedAt ?? null,
      }
    }),
  })
}))

router.post('/api/staff/calendar-events/:id/attendance', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Attendance requires MongoDB.' })
  const event = await CalendarEvent.findById(req.params.id).lean()
  if (!event) return res.status(404).json({ error: 'Event not found.' })
  if (!event.courseId) return res.status(400).json({ error: 'This event is not linked to a course, so attendance cannot be recorded.' })
  const values = attendanceInput.parse(req.body)
  const now = new Date()
  await Promise.all(values.records.map((record) => Attendance.findOneAndUpdate(
    { eventId: event._id, learnerId: record.learnerId },
    {
      $set: {
        courseId: event.courseId,
        status: record.status,
        remarks: (record.remarks ?? '').trim(),
        markedBy: req.auth.sub,
        markedAt: now,
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  )))
  await saveAudit('attendance.recorded', 'CalendarEvent', event._id.toString(), { count: values.records.length }, req.auth.sub)
  const attendedLearnerIds = values.records.filter((record) => ['present', 'late'].includes(record.status)).map((record) => record.learnerId)
  await runBadgeRules(String(event.courseId), attendedLearnerIds, ['attendance_count'])
  res.json({ ok: true, count: values.records.length })
}))

// Record or update a single learner's attendance (for walk-ins or inline updates)
router.post('/api/staff/calendar-events/:id/attendance/record', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Attendance requires MongoDB.' })
  const event = await CalendarEvent.findById(req.params.id).lean()
  if (!event) return res.status(404).json({ error: 'Event not found.' })
  if (!event.courseId) return res.status(400).json({ error: 'This event is not linked to a course.' })
  const record = attendanceRecordInput.parse(req.body)
  const user = await User.findById(record.learnerId).select('name email avatarUrl').lean()
  if (!user) return res.status(404).json({ error: 'Learner not found.' })
  const now = new Date()
  const updated = await Attendance.findOneAndUpdate(
    { eventId: event._id, learnerId: record.learnerId },
    {
      $set: {
        courseId: event.courseId,
        status: record.status,
        remarks: (record.remarks ?? '').trim(),
        markedBy: req.auth.sub,
        markedAt: now,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  if (['present', 'late'].includes(record.status)) {
    await runBadgeRules(String(event.courseId), [record.learnerId], ['attendance_count'])
  }
  await saveAudit('attendance.single_recorded', 'Attendance', updated._id.toString(), { learnerId: record.learnerId, status: record.status }, req.auth.sub)
  res.json({
    ok: true,
    record: {
      learnerId: user._id.toString(),
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl ?? null,
      status: updated.status,
      remarks: updated.remarks ?? '',
      markedAt: updated.markedAt,
    },
  })
}))

// Delete an individual learner's attendance record (clears their mark)
router.delete('/api/staff/calendar-events/:id/attendance/:learnerId', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Attendance requires MongoDB.' })
  const event = await CalendarEvent.findById(req.params.id).lean()
  if (!event) return res.status(404).json({ error: 'Event not found.' })
  await Attendance.deleteOne({ eventId: event._id, learnerId: req.params.learnerId })
  await saveAudit('attendance.single_deleted', 'Attendance', `${event._id}:${req.params.learnerId}`, {}, req.auth.sub)
  res.json({ ok: true })
}))

// Reset / Clear all attendance records for a session
router.delete('/api/staff/calendar-events/:id/attendance', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Attendance requires MongoDB.' })
  const event = await CalendarEvent.findById(req.params.id).lean()
  if (!event) return res.status(404).json({ error: 'Event not found.' })
  const deleted = await Attendance.deleteMany({ eventId: event._id })
  await saveAudit('attendance.cleared', 'CalendarEvent', event._id.toString(), { deletedCount: deleted.deletedCount }, req.auth.sub)
  res.json({ ok: true, deletedCount: deleted.deletedCount })
}))

// Program Attendance Summary & Master Matrix for a course
router.get('/api/staff/courses/:id/attendance-summary', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Attendance summary requires MongoDB.' })
  const course = await Course.findById(req.params.id).select('title').lean()
  if (!course) return res.status(404).json({ error: 'Course not found.' })

  const events = await CalendarEvent.find({
    courseId: course._id,
    eventType: { $in: ['live_review', 'office_hours'] },
  }).sort({ startsAt: 1 }).lean()

  const progresses = await LearningProgress.find({ courseId: course._id }).select('learnerId').lean()
  const records = await Attendance.find({ courseId: course._id }).lean()
  const learnerIdSet = new Set([
    ...progresses.map((p) => String(p.learnerId)),
    ...records.map((r) => String(r.learnerId)),
  ])
  const learners = await User.find({ _id: { $in: Array.from(learnerIdSet) } }).select('name email avatarUrl').sort({ name: 1 }).lean()

  const recordsByLearnerAndEvent = new Map()
  for (const record of records) {
    const key = `${record.learnerId}:${record.eventId}`
    recordsByLearnerAndEvent.set(key, record)
  }

  const sessionsSummary = events.map((ev) => {
    const eventRecords = records.filter((r) => String(r.eventId) === String(ev._id))
    const present = eventRecords.filter((r) => r.status === 'present').length
    const late = eventRecords.filter((r) => r.status === 'late').length
    const excused = eventRecords.filter((r) => r.status === 'excused').length
    const absent = eventRecords.filter((r) => r.status === 'absent').length
    const totalMarked = present + late + excused + absent
    const attendees = present + late
    const attendanceRate = totalMarked > 0 ? Math.round((attendees / totalMarked) * 100) : null
    const markedTimes = eventRecords.map((r) => r.markedAt).filter(Boolean).map((t) => new Date(t).getTime())

    return {
      id: ev._id.toString(),
      title: ev.title,
      description: ev.description ?? null,
      meetingUrl: ev.meetingUrl ?? null,
      startsAt: ev.startsAt,
      endsAt: ev.endsAt ?? null,
      eventType: ev.eventType,
      recordedAt: markedTimes.length ? new Date(Math.max(...markedTimes)) : null,
      present,
      late,
      excused,
      absent,
      unmarked: Math.max(0, learners.length - totalMarked),
      totalLearners: learners.length,
      attendanceRate,
    }
  })

  const recordedSessions = sessionsSummary.filter((s) => s.recordedAt !== null)
  const recordedSessionIds = new Set(recordedSessions.map((s) => s.id))

  const learnersSummary = learners.map((learner) => {
    const learnerIdStr = String(learner._id)
    const learnerRecords = {}
    let present = 0
    let late = 0
    let excused = 0
    let absent = 0
    let unmarked = 0

    for (const ev of events) {
      const rec = recordsByLearnerAndEvent.get(`${learnerIdStr}:${ev._id}`)
      if (rec) {
        learnerRecords[ev._id.toString()] = {
          status: rec.status,
          remarks: rec.remarks ?? '',
          markedAt: rec.markedAt ?? null,
        }
        if (rec.status === 'present') present++
        else if (rec.status === 'late') late++
        else if (rec.status === 'excused') excused++
        else if (rec.status === 'absent') absent++
      } else {
        learnerRecords[ev._id.toString()] = null
        if (recordedSessionIds.has(String(ev._id))) {
          unmarked++
        }
      }
    }

    const totalEvaluated = recordedSessions.length
    const attendedCount = present + late
    const attendanceRate = totalEvaluated > 0 ? Math.round((attendedCount / totalEvaluated) * 100) : 100

    let standing = 'good'
    if (totalEvaluated >= 2) {
      if (attendanceRate < 60 || absent >= 4) standing = 'critical'
      else if (attendanceRate < 80 || absent >= 2) standing = 'warning'
    }

    return {
      learnerId: learnerIdStr,
      name: learner.name,
      email: learner.email,
      avatarUrl: learner.avatarUrl ?? null,
      stats: {
        totalSessions: events.length,
        recordedSessions: totalEvaluated,
        present,
        late,
        excused,
        absent,
        unmarked,
        attendedCount,
        attendanceRate,
        standing,
      },
      records: learnerRecords,
    }
  })

  const totalPossibleAttendances = learners.length * recordedSessions.length
  const totalActualAttendances = learnersSummary.reduce((acc, l) => acc + l.stats.attendedCount, 0)
  const overallRate = totalPossibleAttendances > 0 ? Math.round((totalActualAttendances / totalPossibleAttendances) * 100) : 100
  const atRiskLearners = learnersSummary.filter((l) => l.stats.standing === 'critical' || l.stats.standing === 'warning')
  const perfectAttendance = learnersSummary.filter((l) => recordedSessions.length > 0 && l.stats.absent === 0 && l.stats.unmarked === 0)

  res.json({
    course: { id: course._id.toString(), title: course.title },
    sessions: sessionsSummary,
    learners: learnersSummary,
    analytics: {
      totalSessions: events.length,
      recordedSessions: recordedSessions.length,
      totalLearners: learners.length,
      overallAttendanceRate: overallRate,
      atRiskCount: atRiskLearners.length,
      perfectAttendanceCount: perfectAttendance.length,
    },
  })
}))

router.get('/api/calendar-events/:id/attendance/me', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Attendance requires MongoDB.' })
  if (req.auth.role !== 'learner') return res.json({ status: null })
  const record = await Attendance.findOne({ eventId: req.params.id, learnerId: req.auth.sub }).select('status markedAt remarks').lean()
  res.json({ status: record?.status ?? null, remarks: record?.remarks ?? '', markedAt: record?.markedAt ?? null })
}))
