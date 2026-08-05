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
const attendanceInput = z.object({
  records: z.array(z.object({ learnerId: z.string().trim().min(1), status: z.enum(['present', 'absent', 'excused', 'late']) })).min(1).max(500),
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
  const learners = await User.find({ _id: { $in: progresses.map((progress) => progress.learnerId) } }).select('name email').sort({ name: 1 }).lean()
  const records = await Attendance.find({ eventId: event._id }).lean()
  const byLearner = new Map(records.map((record) => [String(record.learnerId), record]))
  // recordedAt lets the roll-call screen distinguish "never taken" from "already saved" without
  // inferring it from whether every status happens to be null — a roster legitimately saved as all
  // absent would otherwise look untouched.
  const markedTimes = records.map((record) => record.markedAt).filter(Boolean).map((value) => new Date(value).getTime())
  res.json({
    event: { id: event._id.toString(), title: event.title, startsAt: event.startsAt, courseId: String(event.courseId) },
    recordedAt: markedTimes.length ? new Date(Math.max(...markedTimes)) : null,
    roster: learners.map((learner) => {
      const record = byLearner.get(String(learner._id))
      return { learnerId: learner._id.toString(), name: learner.name, email: learner.email, status: record?.status ?? null, markedAt: record?.markedAt ?? null }
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
    { $set: { courseId: event.courseId, status: record.status, markedBy: req.auth.sub, markedAt: now } },
    { upsert: true, setDefaultsOnInsert: true },
  )))
  await saveAudit('attendance.recorded', 'CalendarEvent', event._id.toString(), { count: values.records.length }, req.auth.sub)
  // Only learners marked present/late can possibly have crossed an attendance-count threshold —
  // an absence never makes a rule newly true, so there's nothing to re-check for those rows.
  const attendedLearnerIds = values.records.filter((record) => ['present', 'late'].includes(record.status)).map((record) => record.learnerId)
  await runBadgeRules(String(event.courseId), attendedLearnerIds, ['attendance_count'])
  res.json({ ok: true, count: values.records.length })
}))

router.get('/api/calendar-events/:id/attendance/me', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Attendance requires MongoDB.' })
  if (req.auth.role !== 'learner') return res.json({ status: null })
  const record = await Attendance.findOne({ eventId: req.params.id, learnerId: req.auth.sub }).select('status markedAt').lean()
  res.json({ status: record?.status ?? null, markedAt: record?.markedAt ?? null })
}))
