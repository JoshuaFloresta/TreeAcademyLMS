import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CheckCircle2, ChevronRight, Pencil, Plus, Trash2, Users, Video } from 'lucide-react'
import Modal from '../../components/Modal.jsx'
import { useConfirm } from '../../lib/confirmContext.js'
import { useToast } from '../../lib/toastContext.js'
import { createCalendarEvent, deleteCalendarEvent, fetchCalendar, fetchCourses, fetchEventAttendance, fetchMyAttendance, saveEventAttendance, updateCalendarEvent } from '../../lib/lms.js'
import Loading from '../../components/Loading.jsx'

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

// `<input type="date">` alone produced midnight in whatever timezone the browser sat in — which is
// why a session could read "2:15 AM". Splitting date and time and rebuilding a local Date makes the
// time an instructor actually types the time a learner actually sees.
const toDateInput = (value) => { const d = new Date(value); return Number.isNaN(d.valueOf()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const toTimeInput = (value) => { const d = new Date(value); return Number.isNaN(d.valueOf()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
const combine = (date, time) => new Date(`${date}T${time || '00:00'}`).toISOString()

const emptyEvent = () => ({ title: '', date: toDateInput(new Date()), time: '18:00', eventType: 'live_review', courseId: '', description: '', meetingUrl: '' })
const eventToForm = (event) => ({
  title: event.title ?? '', date: toDateInput(event.startsAt), time: toTimeInput(event.startsAt),
  eventType: event.eventType ?? 'live_review', courseId: event.courseId ? String(event.courseId) : '',
  description: event.description ?? '', meetingUrl: event.meetingUrl ?? '',
})

// One form serves both adding and editing — the fields and validation are identical, and keeping
// them in one place is what stops "edit" quietly missing a field that "add" gained later.
function EventFormModal({ open, event, onClose, onSaved }) {
  const toast = useToast()
  const isEdit = Boolean(event)
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses, enabled: open })
  // Keyed by event id at the call site, so opening a different event remounts with fresh values
  // instead of needing an effect to copy props into state.
  const [values, setValues] = useState(() => (event ? eventToForm(event) : emptyEvent()))
  const [error, setError] = useState('')
  const set = (field) => (e) => setValues((prev) => ({ ...prev, [field]: e.target.value }))
  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        title: values.title.trim(),
        startsAt: combine(values.date, values.time),
        eventType: values.eventType,
        courseId: values.courseId,
        description: values.description.trim(),
        meetingUrl: values.meetingUrl.trim(),
      }
      return isEdit ? updateCalendarEvent(event._id, payload) : createCalendarEvent(payload)
    },
    onSuccess: () => { toast.success(isEdit ? 'Session updated.' : 'Event added.'); onSaved() },
    onError: (e) => setError(e.message),
  })
  const submit = (formEvent) => {
    formEvent.preventDefault()
    if (values.title.trim().length < 2) { setError('Give the event a title.'); return }
    if (!values.date) { setError('Pick a date.'); return }
    setError('')
    mutation.mutate()
  }
  return <Modal open={open} onClose={onClose} labelledBy="event-form-title" className="new-event-modal">
    <p className="eyebrow">CALENDAR</p>
    <h2 id="event-form-title">{isEdit ? 'Edit session' : 'Add event'}</h2>
    <form className="builder-editor-form" onSubmit={submit} style={{ marginTop: 14 }}>
      <label className="builder-field"><span>Title</span><input value={values.title} onChange={set('title')} placeholder="Live review: Contracts to Sell" autoFocus /></label>
      <div className="builder-lesson-row">
        <label className="builder-field"><span>Date</span><input type="date" value={values.date} onChange={set('date')} /></label>
        <label className="builder-field"><span>Start time</span><input type="time" value={values.time} onChange={set('time')} /></label>
        <label className="builder-field"><span>Type</span><select value={values.eventType} onChange={set('eventType')}>
          {Object.entries(eventTypeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      </div>
      <label className="builder-field">
        <span>Course (optional — required to take attendance later)</span>
        <select value={values.courseId} onChange={set('courseId')}>
          <option value="">No specific course</option>
          {courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}
        </select>
      </label>
      <label className="builder-field"><span>Meeting link (optional)</span><input type="url" value={values.meetingUrl} onChange={set('meetingUrl')} placeholder="https://zoom.us/j/… or https://meet.google.com/…" /><small>Learners see this as a “Join session” button on the event.</small></label>
      <label className="builder-field"><span>Description (optional)</span><textarea rows={3} value={values.description} onChange={set('description')} placeholder="What will this session cover?" /></label>
      {error && <span className="builder-error">{error}</span>}
      <div className="confirm-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Add event'}</button></div>
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

  if (isLoading) return <Loading label="Loading roster…" />
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

// The hooks live here, not in the modal wrapper. The wrapper renders continuously with `event`
// null (the modal is mounted closed until a day is clicked), and React Compiler reads the closed-
// over `event.courseId` / `event._id` as memoization dependencies on every render — which throws
// the moment it's null. Mounting this only once there's an event keeps those reads safe.
function EventDetailBody({ event, isStaff, onEdit, onDeleted }) {
  const toast = useToast()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const canTakeAttendance = isStaff && event.courseId && attendanceTakeableTypes.includes(event.eventType)
  const removeMutation = useMutation({ mutationFn: () => deleteCalendarEvent(event._id) })
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this session?', message: `“${event.title}” and its attendance records will be permanently removed.`, confirmLabel: 'Delete session' }))) return
    try { await removeMutation.mutateAsync(); toast.success('Session deleted.'); queryClient.invalidateQueries({ queryKey: ['calendar'] }); onDeleted() }
    catch (e) { toast.error(e.message) }
  }
  return <>
    <p className="eyebrow">{eventTypeLabel[event.eventType] ?? event.eventType}{event.courseTitle ? ` · ${event.courseTitle}` : ''}</p>
    <h2 id="event-detail-title">{event.title}</h2>
    <p className="operations-note" style={{ marginTop: -6 }}>{new Date(event.startsAt).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
    {event.description && <p style={{ color: '#5f6a60', fontSize: 13, lineHeight: 1.6 }}>{event.description}</p>}
    {/* noreferrer as well as noopener: the target is instructor-supplied, so it shouldn't be
        handed our URL in the referer either. */}
    {event.meetingUrl && <a className="button button-primary event-join-link" href={event.meetingUrl} target="_blank" rel="noopener noreferrer"><Video size={15} /> Join session</a>}
    {isStaff && <div className="confirm-actions" style={{ marginTop: 16 }}>
      <button type="button" className="button button-ghost button-compact" onClick={() => onEdit(event)}><Pencil size={13} /> Edit session</button>
      <button type="button" className="button button-ghost button-compact button-danger" onClick={remove} disabled={removeMutation.isPending}><Trash2 size={13} /> Delete</button>
    </div>}

    {canTakeAttendance && <div style={{ marginTop: 18 }}>
      <p className="submission-comments-label"><Users size={13} /> Attendance</p>
      <AttendancePanel eventId={event._id} />
    </div>}
    {!isStaff && attendanceTakeableTypes.includes(event.eventType) && <div style={{ marginTop: 18 }}>
      <p className="submission-comments-label"><Users size={13} /> Your attendance</p>
      <LearnerAttendanceBadge eventId={event._id} />
    </div>}
  </>
}

function EventDetailModal({ event, isStaff, onClose, onEdit, onDeleted }) {
  return <Modal open={Boolean(event)} onClose={onClose} labelledBy="event-detail-title" className="event-detail-modal">
    {event && <EventDetailBody event={event} isStaff={isStaff} onEdit={onEdit} onDeleted={onDeleted} />}
  </Modal>
}

export default function CalendarPage({ role }) {
  const [viewDate, setViewDate] = useState(() => { const date = new Date(); date.setDate(1); return date })
  const [addOpen, setAddOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
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
    {/* Keyed so switching between "add" and editing a different session remounts the form with the
        right values, instead of carrying the previous session's fields over. */}
    {isStaff && addOpen && <EventFormModal key="new" open onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); queryClient.invalidateQueries({ queryKey: ['calendar'] }) }} />}
    {isStaff && editingEvent && <EventFormModal key={editingEvent._id} open event={editingEvent} onClose={() => setEditingEvent(null)} onSaved={() => { setEditingEvent(null); queryClient.invalidateQueries({ queryKey: ['calendar'] }) }} />}
    <EventDetailModal
      event={activeEvent}
      isStaff={isStaff}
      onClose={() => setActiveEvent(null)}
      onEdit={(event) => { setActiveEvent(null); setEditingEvent(event) }}
      onDeleted={() => setActiveEvent(null)}
    />
  </>
}
