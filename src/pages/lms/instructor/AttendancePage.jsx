import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Check, CheckCircle2, Plus, Search, UserCheck } from 'lucide-react'
import Loading from '../../../components/Loading.jsx'
import { useToast } from '../../../lib/toastContext.js'
import { createCalendarEvent, fetchCalendar, fetchCourses, fetchEventAttendance, saveEventAttendance } from '../../../lib/lms.js'

// Attendance hangs off a calendar session, not a bare date — one Attendance row per learner per
// event. This page keeps program + date as the way in (what an instructor actually thinks in) and
// resolves the session behind it: auto-selected when the day has exactly one, picked when it has
// several, created inline when it has none. That keeps a single source of truth shared with the
// Calendar page, the learner's own attendance view, and the attendance_count badge rule.
const attendanceStatuses = [
  { value: 'present', label: 'Present' },
  { value: 'late', label: 'Late' },
  { value: 'excused', label: 'Excused' },
  { value: 'absent', label: 'Absent' },
]

// Sessions you can take a roll call for. Deadlines and announcements have no attendees.
const sessionTypes = ['live_review', 'office_hours']

const todayValue = () => {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

// Compares in local time — an event's ISO timestamp is UTC, so slicing its string would put an
// evening session in the wrong day for anyone east of Greenwich (this academy runs 6–9pm in PHT).
const localDateValue = (value) => {
  const date = new Date(value)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}

const timeLabel = (value) => new Date(value).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
const dateLabel = (value) => new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

function NewSessionForm({ courseId, date, onCreated }) {
  const toast = useToast()
  const [values, setValues] = useState({ title: '', startTime: '18:00', endTime: '21:00' })
  const mutation = useMutation({
    mutationFn: () => createCalendarEvent({
      title: values.title.trim(),
      courseId,
      eventType: 'live_review',
      startsAt: new Date(`${date}T${values.startTime}`).toISOString(),
      endsAt: new Date(`${date}T${values.endTime}`).toISOString(),
    }),
    onSuccess: (event) => { toast.success('Session created.'); onCreated(event) },
    onError: (error) => toast.error(error.message),
  })
  const submit = (event) => {
    event.preventDefault()
    if (values.title.trim().length < 2) return
    mutation.mutate()
  }
  return <form className="attendance-new-session" onSubmit={submit}>
    <label className="builder-field"><span>Session name</span><input value={values.title} onChange={(event) => setValues((prev) => ({ ...prev, title: event.target.value }))} placeholder="e.g. RECLEx Friday Session" /></label>
    <label className="builder-field"><span>Starts</span><input type="time" value={values.startTime} onChange={(event) => setValues((prev) => ({ ...prev, startTime: event.target.value }))} /></label>
    <label className="builder-field"><span>Ends</span><input type="time" value={values.endTime} onChange={(event) => setValues((prev) => ({ ...prev, endTime: event.target.value }))} /></label>
    <button className="button button-primary button-compact" disabled={mutation.isPending || values.title.trim().length < 2}><Plus size={14} /> {mutation.isPending ? 'Creating…' : 'Create session'}</button>
  </form>
}

function RollCall({ session, onSaved }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['event-attendance', session.id], queryFn: () => fetchEventAttendance(session.id) })
  // `draft` holds unsaved edits. It resets to null on save so the roster falls back to whatever the
  // server just confirmed, rather than leaving stale local state shadowing it.
  const [draft, setDraft] = useState(null)
  const [search, setSearch] = useState('')
  // Memoised because the `?? []` fallback would otherwise mint a new array identity on every
  // render, invalidating the search filter's useMemo below each time.
  const roster = useMemo(() => draft ?? data?.roster ?? [], [draft, data?.roster])

  const mutation = useMutation({
    mutationFn: () => saveEventAttendance(session.id, roster.map((row) => ({ learnerId: row.learnerId, status: row.status ?? 'absent' }))),
    onSuccess: () => {
      toast.success('Attendance saved.')
      setDraft(null)
      queryClient.invalidateQueries({ queryKey: ['event-attendance', session.id] })
      onSaved?.()
    },
    onError: (mutationError) => toast.error(mutationError.message),
  })

  const setStatus = (learnerId, status) => setDraft((current) => (current ?? data?.roster ?? []).map((row) => (row.learnerId === learnerId ? { ...row, status } : row)))
  // Marks only who is currently visible, so searching then marking all can't silently change
  // someone filtered out of view.
  const markAllPresent = (visibleIds) => setDraft((current) => (current ?? data?.roster ?? []).map((row) => (visibleIds.has(row.learnerId) ? { ...row, status: 'present' } : row)))

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return roster
    return roster.filter((row) => row.name?.toLowerCase().includes(term) || row.email?.toLowerCase().includes(term))
  }, [roster, search])

  if (isLoading) return <Loading block label="Loading roster…" />
  if (isError) return <p className="form-alert" role="alert">{error?.message ?? 'Could not load this roster.'}</p>
  if (!data?.roster?.length) return <p className="operations-note"><UserCheck size={17} /> No learners have access to this program yet, so there is no one to check off.</p>

  const marked = roster.filter((row) => row.status).length
  const dirty = draft !== null

  return <>
    <div className="attendance-toolbar">
      <label className="attendance-search">
        <Search size={15} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this program by name or email" aria-label="Search members" />
      </label>
      <button type="button" className="button button-ghost button-compact" onClick={() => markAllPresent(new Set(visible.map((row) => row.learnerId)))} disabled={!visible.length}>
        <Check size={14} /> Mark all present{search.trim() && visible.length !== roster.length ? ` (${visible.length})` : ''}
      </button>
    </div>

    <div className="attendance-roster">
      {!visible.length && <p className="operations-note">No members match “{search.trim()}”.</p>}
      {visible.map((row) => <div className="attendance-row" key={row.learnerId}>
        <span className="attendance-member">
          <span className="avatar">{(row.name ?? '?').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span>
          <span><strong>{row.name}</strong><small>{row.email}</small></span>
        </span>
        <div className="attendance-status-group">
          {attendanceStatuses.map((status) => <button
            type="button"
            key={status.value}
            className={`attendance-status-pill ${status.value} ${row.status === status.value ? 'active' : ''}`}
            onClick={() => setStatus(row.learnerId, status.value)}
            aria-pressed={row.status === status.value}
          >{status.label}</button>)}
        </div>
      </div>)}
    </div>

    <div className="attendance-submit-row">
      <span className="attendance-count">{marked} of {roster.length} marked{dirty ? ' · unsaved changes' : ''}</span>
      <button type="button" className="button button-primary button-compact" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
        <Check size={14} /> {mutation.isPending ? 'Saving…' : 'Save attendance'}
      </button>
    </div>
  </>
}

export default function AttendancePage({ role }) {
  const [courseId, setCourseId] = useState('')
  const [date, setDate] = useState(todayValue)
  const [sessionId, setSessionId] = useState('')
  const [creating, setCreating] = useState(false)
  const queryClient = useQueryClient()

  const { data: courses = [], isLoading: coursesLoading } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses, enabled: role !== 'learner' })
  const { data: events = [], isLoading: eventsLoading } = useQuery({ queryKey: ['calendar'], queryFn: () => fetchCalendar(), enabled: role !== 'learner' })

  const activeCourseId = courseId || courses[0]?._id || ''
  const activeCourse = courses.find((course) => course._id === activeCourseId)

  // Sessions for the selected program on the selected day, earliest first.
  const sessions = useMemo(() => events
    .filter((event) => sessionTypes.includes(event.eventType) && String(event.courseId ?? '') === String(activeCourseId) && localDateValue(event.startsAt) === date)
    .sort((first, second) => new Date(first.startsAt) - new Date(second.startsAt))
    .map((event) => ({ id: event._id ?? event.id, title: event.title, startsAt: event.startsAt })), [events, activeCourseId, date])

  // A stale selection from a previous day/program must not leak through — fall back to the only
  // session when there is exactly one, which is the common case for a review class.
  const activeSession = sessions.find((session) => session.id === sessionId) ?? (sessions.length === 1 ? sessions[0] : null)

  const { data: attendance } = useQuery({
    queryKey: ['event-attendance', activeSession?.id],
    queryFn: () => fetchEventAttendance(activeSession.id),
    enabled: Boolean(activeSession?.id),
  })

  const onCourseChange = (value) => { setCourseId(value); setSessionId(''); setCreating(false) }
  const onDateChange = (value) => { setDate(value); setSessionId(''); setCreating(false) }

  if (role === 'learner') return <p className="operations-note">Attendance is available to instructors and admins only.</p>

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">TEACHING WORKSPACE</p><h1>Attendance</h1><p>Take a roll call for a program's session on any date.</p></div>
    </div>

    <div className="attendance-filters">
      <label className="builder-field">
        <span>Program</span>
        <select value={activeCourseId} onChange={(event) => onCourseChange(event.target.value)} aria-label="Select program" disabled={coursesLoading || !courses.length}>
          {!courses.length && <option value="">No programs available</option>}
          {courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}
        </select>
      </label>
      <label className="builder-field">
        <span>Date</span>
        <input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} aria-label="Attendance date" />
      </label>
      <label className="builder-field">
        <span>Session {sessions.length > 1 ? '' : '(optional)'}</span>
        <select value={activeSession?.id ?? ''} onChange={(event) => setSessionId(event.target.value)} aria-label="Select session" disabled={sessions.length < 2}>
          {!sessions.length && <option value="">No session on this date</option>}
          {sessions.map((session) => <option key={session.id} value={session.id}>{timeLabel(session.startsAt)} · {session.title}</option>)}
        </select>
      </label>
    </div>

    {coursesLoading || eventsLoading ? <Loading block label="Loading programs…" />
      : !courses.length ? <div className="empty-state"><CalendarDays size={26} /><strong>No programs yet</strong><p>Create a course before taking attendance.</p></div>
      : <div className="attendance-card">
        <div className="attendance-card-head">
          <div>
            <p className="eyebrow">{activeCourse?.title ?? 'Program'}</p>
            <h2>{dateLabel(date)}</h2>
            {activeSession && <small>{timeLabel(activeSession.startsAt)} · {activeSession.title}</small>}
          </div>
          {activeSession && (attendance?.recordedAt
            ? <span className="attendance-state recorded"><CheckCircle2 size={14} /> Recorded {new Date(attendance.recordedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            : <span className="attendance-state pending"><CalendarDays size={14} /> Not yet recorded</span>)}
        </div>

        {!sessions.length && !creating && <div className="attendance-empty">
          <p className="operations-note"><CalendarDays size={17} /> No session is scheduled for {activeCourse?.title ?? 'this program'} on this date.</p>
          <button type="button" className="button button-primary button-compact" onClick={() => setCreating(true)}><Plus size={14} /> Create a session for this date</button>
        </div>}

        {!sessions.length && creating && <NewSessionForm
          courseId={activeCourseId}
          date={date}
          onCreated={(event) => {
            setCreating(false)
            setSessionId(event._id ?? event.id)
            queryClient.invalidateQueries({ queryKey: ['calendar'] })
          }}
        />}

        {sessions.length > 1 && !sessionId && <p className="operations-note">This date has {sessions.length} sessions — choose one above to take its roll call.</p>}

        {activeSession && <RollCall session={activeSession} onSaved={() => queryClient.invalidateQueries({ queryKey: ['calendar'] })} />}
      </div>}
  </>
}
