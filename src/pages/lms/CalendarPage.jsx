import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CheckCircle2, ChevronRight, Plus, Users } from 'lucide-react'
import Modal from '../../components/Modal.jsx'
import { useToast } from '../../lib/toastContext.js'
import { createCalendarEvent, fetchCalendar, fetchCourses, fetchEventAttendance, fetchMyAttendance, saveEventAttendance } from '../../lib/lms.js'

const weekdayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const eventTypeLabel = { live_review: 'Live review', deadline: 'Deadline', announcement: 'Announcement', office_hours: 'Office hours' }
const attendanceTakeableTypes = ['live_review', 'office_hours']
const attendanceStatuses = [
  { value: 'present', label: 'Present' },
  { value: 'late', label: 'Late' },
  { value: 'excused', label: 'Excused' },
  { value: 'absent', label: 'Absent' },
]
const statusLabel = Object.fromEntries(attendanceStatuses.map((item) => [item.value, item.label]))

function buildMonthGrid(viewDate, eventsByDay) {
  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()
  const today = new Date()
  const cells = []
  for (let index = 0; index < 42; index += 1) {
    const dayNumber = index - firstWeekday + 1
    const isCurrentMonth = dayNumber > 0 && dayNumber <= daysInMonth
    const displayNumber = isCurrentMonth ? dayNumber : dayNumber < 1 ? daysInPrevMonth + dayNumber : dayNumber - daysInMonth
    const isToday = isCurrentMonth && today.getFullYear() === year && today.getMonth() === month && today.getDate() === dayNumber
    const dayEvents = isCurrentMonth ? (eventsByDay.get(dayNumber) ?? []) : []
    cells.push({ index, dayNumber, displayNumber, isCurrentMonth, isToday, events: dayEvents })
  }
  return cells
}

function NewEventModal({ open, onClose, onCreated }) {
  const toast = useToast()
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses, enabled: open })
  const [values, setValues] = useState({ title: '', date: new Date().toISOString().slice(0, 10), eventType: 'live_review', courseId: '', description: '' })
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: () => createCalendarEvent({ title: values.title.trim(), startsAt: values.date, eventType: values.eventType, courseId: values.courseId || undefined, description: values.description.trim() || undefined }),
    onSuccess: () => { toast.success('Event added.'); setValues((prev) => ({ ...prev, title: '', description: '' })); onCreated() },
    onError: (e) => setError(e.message),
  })
  const submit = (event) => {
    event.preventDefault()
    if (values.title.trim().length < 2) { setError('Give the event a title.'); return }
    setError('')
    mutation.mutate()
  }
  return <Modal open={open} onClose={onClose} labelledBy="new-event-title" className="new-event-modal">
    <p className="eyebrow">CALENDAR</p>
    <h2 id="new-event-title">Add event</h2>
    <form className="builder-editor-form" onSubmit={submit} style={{ marginTop: 14 }}>
      <label className="builder-field"><span>Title</span><input value={values.title} onChange={(event) => setValues((prev) => ({ ...prev, title: event.target.value }))} placeholder="Live review: Contracts to Sell" /></label>
      <div className="builder-lesson-row">
        <label className="builder-field"><span>Date</span><input type="date" value={values.date} onChange={(event) => setValues((prev) => ({ ...prev, date: event.target.value }))} /></label>
        <label className="builder-field"><span>Type</span><select value={values.eventType} onChange={(event) => setValues((prev) => ({ ...prev, eventType: event.target.value }))}>
          {Object.entries(eventTypeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      </div>
      <label className="builder-field">
        <span>Course (optional — required to take attendance later)</span>
        <select value={values.courseId} onChange={(event) => setValues((prev) => ({ ...prev, courseId: event.target.value }))}>
          <option value="">No specific course</option>
          {courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}
        </select>
      </label>
      <label className="builder-field"><span>Description (optional)</span><textarea rows={2} value={values.description} onChange={(event) => setValues((prev) => ({ ...prev, description: event.target.value }))} /></label>
      {error && <span className="builder-error">{error}</span>}
      <div className="confirm-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Adding…' : 'Add event'}</button></div>
    </form>
  </Modal>
}

function AttendancePanel({ eventId }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['event-attendance', eventId], queryFn: () => fetchEventAttendance(eventId) })
  const [draft, setDraft] = useState(null)
  const roster = draft ?? data?.roster ?? []
  const mutation = useMutation({
    mutationFn: () => saveEventAttendance(eventId, roster.map((row) => ({ learnerId: row.learnerId, status: row.status ?? 'absent' }))),
    onSuccess: () => { toast.success('Attendance saved.'); queryClient.invalidateQueries({ queryKey: ['event-attendance', eventId] }) },
    onError: (e) => toast.error(e.message),
  })
  const setStatus = (learnerId, status) => setDraft((current) => (current ?? data?.roster ?? []).map((row) => (row.learnerId === learnerId ? { ...row, status } : row)))

  if (isLoading) return <p className="operations-note">Loading roster…</p>
  if (!roster.length) return <p className="operations-note">No learners are enrolled in this course yet.</p>

  return <div className="attendance-panel">
    <div className="attendance-roster">
      {roster.map((row) => <div className="attendance-row" key={row.learnerId}>
        <span className="attendance-name">{row.name}</span>
        <div className="attendance-status-group">
          {attendanceStatuses.map((status) => <button type="button" key={status.value} className={`attendance-status-pill ${status.value} ${(row.status ?? 'absent') === status.value ? 'active' : ''}`} onClick={() => setStatus(row.learnerId, status.value)}>{status.label}</button>)}
        </div>
      </div>)}
    </div>
    <div className="confirm-actions" style={{ marginTop: 14 }}>
      <button type="button" className="button button-primary button-compact" disabled={mutation.isPending} onClick={() => mutation.mutate()}><Check size={14} /> {mutation.isPending ? 'Saving…' : 'Save attendance'}</button>
    </div>
  </div>
}

function LearnerAttendanceBadge({ eventId }) {
  const { data } = useQuery({ queryKey: ['my-attendance', eventId], queryFn: () => fetchMyAttendance(eventId) })
  if (!data?.status) return <p className="operations-note">Attendance for this session hasn't been recorded yet.</p>
  return <p className={`attendance-self-pill ${data.status}`}><CheckCircle2 size={14} /> Marked {statusLabel[data.status] ?? data.status}</p>
}

function EventDetailModal({ event, isStaff, onClose }) {
  const canTakeAttendance = isStaff && event?.courseId && attendanceTakeableTypes.includes(event?.eventType)
  return <Modal open={Boolean(event)} onClose={onClose} labelledBy="event-detail-title" className="event-detail-modal">
    {event && <>
      <p className="eyebrow">{eventTypeLabel[event.eventType] ?? event.eventType}{event.courseTitle ? ` · ${event.courseTitle}` : ''}</p>
      <h2 id="event-detail-title">{event.title}</h2>
      <p className="operations-note" style={{ marginTop: -6 }}>{new Date(event.startsAt).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
      {event.description && <p style={{ color: '#5f6a60', fontSize: 13, lineHeight: 1.6 }}>{event.description}</p>}

      {canTakeAttendance && <div style={{ marginTop: 18 }}>
        <p className="submission-comments-label"><Users size={13} /> Attendance</p>
        <AttendancePanel eventId={event._id} />
      </div>}
      {!isStaff && attendanceTakeableTypes.includes(event.eventType) && <div style={{ marginTop: 18 }}>
        <p className="submission-comments-label"><Users size={13} /> Your attendance</p>
        <LearnerAttendanceBadge eventId={event._id} />
      </div>}
    </>}
  </Modal>
}

export default function CalendarPage({ role }) {
  const [viewDate, setViewDate] = useState(() => { const date = new Date(); date.setDate(1); return date })
  const [addOpen, setAddOpen] = useState(false)
  const [activeEvent, setActiveEvent] = useState(null)
  const queryClient = useQueryClient()
  const { data: events = [] } = useQuery({ queryKey: ['calendar'], queryFn: () => fetchCalendar() })
  const isStaff = role === 'instructor' || role === 'admin'

  const eventsByDay = useMemo(() => {
    const map = new Map()
    for (const event of events) {
      const date = new Date(event.startsAt)
      if (date.getFullYear() !== viewDate.getFullYear() || date.getMonth() !== viewDate.getMonth()) continue
      const day = date.getDate()
      if (!map.has(day)) map.set(day, [])
      map.get(day).push(event)
    }
    return map
  }, [events, viewDate])

  const cells = buildMonthGrid(viewDate, eventsByDay)
  const shiftMonth = (delta) => setViewDate((current) => { const next = new Date(current); next.setMonth(next.getMonth() + delta); return next })

  return <>
    <div className="page-title-row"><div><p className="eyebrow">PLAN YOUR MOMENTUM</p><h1>Learning calendar</h1><p>Sessions, submission dates, and academy events in one view.</p></div>{isStaff && <button className="button button-primary" onClick={() => setAddOpen(true)}><Plus size={17} /> Add event</button>}</div>
    <div className="calendar-card">
      <div className="calendar-head"><button onClick={() => shiftMonth(-1)} aria-label="Previous month"><ChevronRight className="rotate" size={18} /></button><h2>{viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2><button onClick={() => shiftMonth(1)} aria-label="Next month"><ChevronRight size={18} /></button></div>
      <div className="calendar-grid">
        {weekdayLabels.map((day, index) => <span className="calendar-weekday" key={`${day}-${index}`}>{day}</span>)}
        {cells.map((cell) => <div className={`calendar-day ${cell.isToday ? 'today' : ''} ${cell.isCurrentMonth ? '' : 'muted'}`} key={cell.index}>
          <span>{cell.displayNumber}</span>
          {cell.events.slice(0, 3).map((event) => <i key={event._id} className={event.eventType === 'deadline' ? 'gold' : ''} title={event.title} onClick={() => setActiveEvent(event)} role="button" tabIndex={0}>{event.title}</i>)}
        </div>)}
      </div>
    </div>
    {isStaff && <NewEventModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={() => { setAddOpen(false); queryClient.invalidateQueries({ queryKey: ['calendar'] }) }} />}
    <EventDetailModal event={activeEvent} isStaff={isStaff} onClose={() => setActiveEvent(null)} />
  </>
}
