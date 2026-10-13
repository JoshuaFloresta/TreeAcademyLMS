import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  TrendingUp,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react'
import Loading from '../../../components/Loading.jsx'
import { useToast } from '../../../lib/toastContext.js'
import {
  clearEventAttendance,
  createCalendarEvent,
  deleteCalendarEvent,
  deleteEventAttendanceRecord,
  fetchCalendar,
  fetchCourseAttendanceSummary,
  fetchCourses,
  fetchEventAttendance,
  fetchLearners,
  saveEventAttendance,
  saveEventAttendanceRecord,
  updateCalendarEvent,
} from '../../../lib/lms.js'
import {
  copySessionRosterToClipboard,
  exportMasterMatrixToCsv,
  exportSessionToCsv,
} from '../../../lib/attendanceExport.js'

const attendanceStatuses = [
  { value: 'present', label: 'Present' },
  { value: 'late', label: 'Late' },
  { value: 'excused', label: 'Excused' },
  { value: 'absent', label: 'Absent' },
]

const statusLabel = Object.fromEntries(attendanceStatuses.map((s) => [s.value, s.label]))
const sessionTypes = ['live_review', 'office_hours']

const todayValue = () => {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

const localDateValue = (value) => {
  if (!value) return ''
  const date = new Date(value)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}

const timeLabel = (value) => (value ? new Date(value).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : '')
const dateLabel = (value) => (value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '')

// Modal: Create or Edit Calendar Session
function SessionModal({ isOpen, onClose, courseId, date, session = null, onSaved }) {
  const toast = useToast()
  const isEditing = Boolean(session?.id)

  const defaultStartTime = session?.startsAt
    ? new Date(session.startsAt).toTimeString().slice(0, 5)
    : '18:00'
  const defaultEndTime = session?.endsAt
    ? new Date(session.endsAt).toTimeString().slice(0, 5)
    : '21:00'
  const defaultDate = session?.startsAt ? localDateValue(session.startsAt) : date || todayValue()

  const [formData, setFormData] = useState({
    title: session?.title || '',
    date: defaultDate,
    startTime: defaultStartTime,
    endTime: defaultEndTime,
    eventType: session?.eventType || 'live_review',
    meetingUrl: session?.meetingUrl || '',
    description: session?.description || '',
  })

  const mutation = useMutation({
    mutationFn: async () => {
      const startsAt = new Date(`${formData.date}T${formData.startTime}`).toISOString()
      const endsAt = formData.endTime ? new Date(`${formData.date}T${formData.endTime}`).toISOString() : null
      const payload = {
        title: formData.title.trim(),
        courseId,
        eventType: formData.eventType,
        startsAt,
        endsAt,
        meetingUrl: formData.meetingUrl.trim() || null,
        description: formData.description.trim() || null,
      }
      if (isEditing) {
        return updateCalendarEvent(session.id, payload)
      }
      return createCalendarEvent(payload)
    },
    onSuccess: (saved) => {
      toast.success(isEditing ? 'Session updated.' : 'Session created.')
      onSaved(saved)
      onClose()
    },
    onError: (err) => toast.error(err.message),
  })

  if (!isOpen) return null

  const handleSubmit = (e) => {
    e.preventDefault()
    if (formData.title.trim().length < 2) {
      toast.error('Session title must be at least 2 characters.')
      return
    }
    if (formData.endTime && formData.endTime <= formData.startTime) {
      toast.error('The end time must be after the start time.')
      return
    }
    mutation.mutate()
  }

  return (
    <div className="attendance-modal-backdrop" onClick={onClose}>
      <div className="attendance-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="attendance-modal-head">
          <h3>{isEditing ? 'Edit Session' : 'Create Session'}</h3>
          <button type="button" className="attendance-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '14px' }}>
          <label className="builder-field">
            <span>Session Title</span>
            <input
              required
              value={formData.title}
              onChange={(e) => setFormData((p) => ({ ...p, title: e.target.value }))}
              placeholder="e.g. Real Estate Practice Review"
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <label className="builder-field">
              <span>Date</span>
              <input
                type="date"
                required
                value={formData.date}
                onChange={(e) => setFormData((p) => ({ ...p, date: e.target.value }))}
              />
            </label>
            <label className="builder-field">
              <span>Starts At</span>
              <input
                type="time"
                required
                value={formData.startTime}
                onChange={(e) => setFormData((p) => ({ ...p, startTime: e.target.value }))}
              />
            </label>
            <label className="builder-field">
              <span>Ends At</span>
              <input
                type="time"
                value={formData.endTime}
                onChange={(e) => setFormData((p) => ({ ...p, endTime: e.target.value }))}
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px' }}>
            <label className="builder-field">
              <span>Session Type</span>
              <select
                value={formData.eventType}
                onChange={(e) => setFormData((p) => ({ ...p, eventType: e.target.value }))}
              >
                <option value="live_review">Live Review</option>
                <option value="office_hours">Office Hours</option>
              </select>
            </label>
            <label className="builder-field">
              <span>Meeting / Zoom Link (Optional)</span>
              <input
                type="url"
                value={formData.meetingUrl}
                onChange={(e) => setFormData((p) => ({ ...p, meetingUrl: e.target.value }))}
                placeholder="https://zoom.us/j/..."
              />
            </label>
          </div>
          <label className="builder-field">
            <span>Description / Topics Covered (Optional)</span>
            <textarea
              rows={2}
              value={formData.description}
              onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
              placeholder="Key subjects or instructions for this session..."
            />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
            <button type="button" className="button button-ghost button-compact" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="button button-primary button-compact"
              disabled={mutation.isPending}
            >
              <Check size={14} /> {mutation.isPending ? 'Saving…' : isEditing ? 'Update Session' : 'Create Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Modal: Student Remarks / Notes
function RemarkModal({ isOpen, onClose, student, onSave }) {
  const [remarkText, setRemarkText] = useState(student?.remarks || '')

  if (!isOpen || !student) return null

  const handleSave = () => {
    onSave(student.learnerId, remarkText.trim())
    onClose()
  }

  return (
    <div className="attendance-modal-backdrop" onClick={onClose}>
      <div className="attendance-modal-content" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
        <div className="attendance-modal-head">
          <h3>Attendance Remark</h3>
          <button type="button" className="attendance-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#556054' }}>
          Add an excuse, note, or observation for <strong>{student.name}</strong>.
        </p>
        <textarea
          rows={3}
          style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #d9e1d8', font: 'inherit', fontSize: '13px' }}
          placeholder="e.g. Arrived 20 mins late due to heavy rain; Excuse letter submitted..."
          value={remarkText}
          onChange={(e) => setRemarkText(e.target.value)}
          autoFocus
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
          <button type="button" className="button button-ghost button-compact" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button button-primary button-compact" onClick={handleSave}>
            Save Remark
          </button>
        </div>
      </div>
    </div>
  )
}

// Modal: Add Walk-in / Registered Student to Session
function WalkInModal({ isOpen, onClose, session, existingLearnerIds, onStudentAdded }) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [status, setStatus] = useState('present')
  const [remarks, setRemarks] = useState('')

  const { data: learners = [], isLoading } = useQuery({
    queryKey: ['staff-learners'],
    queryFn: () => fetchLearners(),
    enabled: isOpen,
  })

  const availableLearners = useMemo(() => {
    const existing = new Set(existingLearnerIds)
    return learners.filter((l) => !existing.has(l.id))
  }, [learners, existingLearnerIds])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return availableLearners.slice(0, 15)
    return availableLearners.filter((l) => l.name.toLowerCase().includes(q) || l.email.toLowerCase().includes(q)).slice(0, 20)
  }, [availableLearners, query])

  const mutation = useMutation({
    mutationFn: () => saveEventAttendanceRecord(session.id, {
      learnerId: selectedStudent.id,
      status,
      remarks,
    }),
    onSuccess: (data) => {
      toast.success(`${selectedStudent.name} added to roll call.`)
      onStudentAdded(data.record)
      onClose()
    },
    onError: (err) => toast.error(err.message),
  })

  if (!isOpen) return null

  return (
    <div className="attendance-modal-backdrop" onClick={onClose}>
      <div className="attendance-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="attendance-modal-head">
          <h3>Add Student to Session Roll Call</h3>
          <button type="button" className="attendance-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#556054' }}>
          Search any enrolled or registered academy learner to check them off for this session.
        </p>

        {!selectedStudent ? (
          <div>
            <div className="attendance-search" style={{ marginBottom: '12px' }}>
              <Search size={15} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search academy student by name or email…"
                autoFocus
              />
            </div>
            {isLoading ? (
              <Loading block label="Searching academy directory…" />
            ) : !filtered.length ? (
              <p className="operations-note">No eligible learners found.</p>
            ) : (
              <div style={{ maxHeight: '260px', overflowY: 'auto', display: 'grid', gap: '6px' }}>
                {filtered.map((l) => (
                  <div
                    key={l.id}
                    className="attendance-row"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedStudent(l)}
                  >
                    <span className="attendance-member">
                      <span className="avatar">
                        {(l.name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                      </span>
                      <span>
                        <strong>{l.name}</strong>
                        <small>{l.email}</small>
                      </span>
                    </span>
                    <button type="button" className="button button-ghost button-compact">
                      Select
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#f7faf6', borderRadius: '8px', border: '1px solid #d9e1d8' }}>
              <div>
                <strong>{selectedStudent.name}</strong>
                <div style={{ fontSize: '11px', color: '#6b756b' }}>{selectedStudent.email}</div>
              </div>
              <button
                type="button"
                className="button button-ghost button-compact"
                onClick={() => setSelectedStudent(null)}
              >
                Change
              </button>
            </div>

            <label className="builder-field">
              <span>Attendance Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {attendanceStatuses.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="builder-field">
              <span>Remarks (Optional)</span>
              <input
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="e.g. Attending make-up session; Audit student"
              />
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
              <button type="button" className="button button-ghost button-compact" onClick={() => setSelectedStudent(null)}>
                Back
              </button>
              <button
                type="button"
                className="button button-primary button-compact"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                <Plus size={14} /> {mutation.isPending ? 'Adding…' : 'Add to Roll Call'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Modal: Student Attendance History across all sessions
function StudentHistoryModal({ isOpen, onClose, learner, sessions = [], onRecordUpdated }) {
  const toast = useToast()
  const [editingSessionId, setEditingSessionId] = useState(null)
  const [editStatus, setEditStatus] = useState('present')
  const [editRemarks, setEditRemarks] = useState('')

  if (!isOpen || !learner) return null

  const handleStartEdit = (session, currentRecord) => {
    setEditingSessionId(session.id)
    setEditStatus(currentRecord?.status || 'present')
    setEditRemarks(currentRecord?.remarks || '')
  }

  const handleSaveEdit = async (session) => {
    try {
      await saveEventAttendanceRecord(session.id, {
        learnerId: learner.learnerId,
        status: editStatus,
        remarks: editRemarks,
      })
      toast.success('Attendance record updated.')
      setEditingSessionId(null)
      onRecordUpdated?.()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const standingKind = learner.stats?.standing || 'good'

  return (
    <div className="attendance-modal-backdrop" onClick={onClose}>
      <div className="attendance-modal-content" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
        <div className="attendance-modal-head">
          <div>
            <h3>{learner.name}</h3>
            <span style={{ fontSize: '12px', color: '#6b756b' }}>{learner.email}</span>
          </div>
          <button type="button" className="attendance-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <span className={`attendance-standing-badge ${standingKind}`}>
            Standing: {standingKind.toUpperCase()} ({learner.stats?.attendanceRate ?? 0}%)
          </span>
          <span className="attendance-status-tag present">Present: {learner.stats?.present ?? 0}</span>
          <span className="attendance-status-tag late">Late: {learner.stats?.late ?? 0}</span>
          <span className="attendance-status-tag excused">Excused: {learner.stats?.excused ?? 0}</span>
          <span className="attendance-status-tag absent">Absent: {learner.stats?.absent ?? 0}</span>
        </div>

        <div style={{ maxHeight: '380px', overflowY: 'auto', display: 'grid', gap: '8px' }}>
          {sessions.map((s) => {
            const rec = learner.records?.[s.id]
            const isEditingThis = editingSessionId === s.id
            const dateStr = s.startsAt ? new Date(s.startsAt).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : ''
            const timeStr = s.startsAt ? new Date(s.startsAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : ''

            return (
              <div
                key={s.id}
                style={{
                  padding: '10px 14px',
                  background: isEditingThis ? '#fdfbf4' : '#f7faf6',
                  border: isEditingThis ? '1px solid #c99a3f' : '1px solid #edf0ec',
                  borderRadius: '6px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <div>
                    <strong>{s.title}</strong>
                    <div style={{ fontSize: '11px', color: '#8a9088' }}>
                      {dateStr} at {timeStr}
                    </div>
                  </div>
                  {!isEditingThis ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className={`attendance-status-tag ${rec?.status || 'unmarked'}`}>
                        {statusLabel[rec?.status] || 'Not marked'}
                      </span>
                      <button
                        type="button"
                        className="button button-ghost button-compact"
                        style={{ padding: '4px 8px' }}
                        onClick={() => handleStartEdit(s, rec)}
                        title="Edit status"
                      >
                        <Pencil size={12} />
                      </button>
                    </div>
                  ) : null}
                </div>

                {isEditingThis ? (
                  <div style={{ marginTop: '10px', display: 'grid', gap: '8px' }}>
                    <div className="attendance-status-group">
                      {attendanceStatuses.map((st) => (
                        <button
                          type="button"
                          key={st.value}
                          className={`attendance-status-pill ${st.value} ${editStatus === st.value ? 'active' : ''}`}
                          onClick={() => setEditStatus(st.value)}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                    <input
                      style={{ padding: '6px 10px', fontSize: '12px', border: '1px solid #d9e1d8', borderRadius: '4px' }}
                      value={editRemarks}
                      onChange={(e) => setEditRemarks(e.target.value)}
                      placeholder="Add remarks or excuse note…"
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                      <button
                        type="button"
                        className="button button-ghost button-compact"
                        onClick={() => setEditingSessionId(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="button button-primary button-compact"
                        onClick={() => handleSaveEdit(s)}
                      >
                        <Check size={12} /> Save
                      </button>
                    </div>
                  </div>
                ) : (
                  rec?.remarks && (
                    <div style={{ marginTop: '4px', fontSize: '11px', color: '#835f11', fontStyle: 'italic' }}>
                      Note: {rec.remarks}
                    </div>
                  )
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Session Roll Call Component
function RollCall({ session, courseTitle, onSaved }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['event-attendance', session.id],
    queryFn: () => fetchEventAttendance(session.id),
  })

  const [draft, setDraft] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [editing, setEditing] = useState(false)
  const [activeRemarkStudent, setActiveRemarkStudent] = useState(null)
  const [isWalkInOpen, setIsWalkInOpen] = useState(false)
  const [selectedStudentForHistory, setSelectedStudentForHistory] = useState(null)

  const roster = useMemo(() => draft ?? data?.roster ?? [], [draft, data?.roster])

  const visible = useMemo(() => {
    let list = roster
    if (statusFilter !== 'all') {
      if (statusFilter === 'unmarked') {
        list = list.filter((r) => !r.status)
      } else {
        list = list.filter((r) => r.status === statusFilter)
      }
    }
    const term = search.trim().toLowerCase()
    if (!term) return list
    return list.filter((r) => r.name?.toLowerCase().includes(term) || r.email?.toLowerCase().includes(term))
  }, [roster, search, statusFilter])

  const mutation = useMutation({
    mutationFn: () => saveEventAttendance(
      session.id,
      roster.map((row) => ({
        learnerId: row.learnerId,
        status: row.status ?? 'absent',
        remarks: row.remarks ?? '',
      })),
    ),
    onSuccess: () => {
      toast.success('Attendance saved.')
      setDraft(null)
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: ['event-attendance', session.id] })
      queryClient.invalidateQueries({ queryKey: ['course-attendance-summary'] })
      onSaved?.()
    },
    onError: (mutationError) => toast.error(mutationError.message),
  })

  const resetMutation = useMutation({
    mutationFn: () => clearEventAttendance(session.id),
    onSuccess: () => {
      toast.success('Roll call cleared for this session.')
      setDraft(null)
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: ['event-attendance', session.id] })
      queryClient.invalidateQueries({ queryKey: ['course-attendance-summary'] })
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteRecordMutation = useMutation({
    mutationFn: (learnerId) => deleteEventAttendanceRecord(session.id, learnerId),
    onSuccess: () => {
      toast.success('Record reset for student.')
      queryClient.invalidateQueries({ queryKey: ['event-attendance', session.id] })
      queryClient.invalidateQueries({ queryKey: ['course-attendance-summary'] })
    },
    onError: (err) => toast.error(err.message),
  })

  const setStatus = (learnerId, status) => {
    setDraft((current) => (current ?? data?.roster ?? []).map((row) => (row.learnerId === learnerId ? { ...row, status } : row)))
  }

  const setStudentRemark = (learnerId, remarks) => {
    setDraft((current) => (current ?? data?.roster ?? []).map((row) => (row.learnerId === learnerId ? { ...row, remarks } : row)))
    toast.success('Remark added to draft.')
  }

  const markAllVisible = (statusToSet) => {
    const visibleIds = new Set(visible.map((r) => r.learnerId))
    setDraft((current) => (current ?? data?.roster ?? []).map((row) => (visibleIds.has(row.learnerId) ? { ...row, status: statusToSet } : row)))
  }

  const fillUnmarkedAbsent = () => {
    setDraft((current) => (current ?? data?.roster ?? []).map((row) => (!row.status ? { ...row, status: 'absent' } : row)))
  }

  const cancelEdit = () => {
    setDraft(null)
    setEditing(false)
  }

  const handleResetSession = () => {
    if (window.confirm('Are you sure you want to clear and reset the roll call for this session? All marked attendances will be removed.')) {
      resetMutation.mutate()
    }
  }

  if (isLoading) return <Loading block label="Loading session roster…" />
  if (isError) return <p className="form-alert" role="alert">{error?.message ?? 'Could not load this roster.'}</p>

  const isRecorded = Boolean(data?.recordedAt)
  const readOnly = isRecorded && !editing
  const dirty = draft !== null

  const presentCount = roster.filter((r) => r.status === 'present').length
  const lateCount = roster.filter((r) => r.status === 'late').length
  const excusedCount = roster.filter((r) => r.status === 'excused').length
  const absentCount = roster.filter((r) => r.status === 'absent').length
  const unmarkedCount = roster.filter((r) => !r.status).length
  const markedCount = roster.length - unmarkedCount
  const sessionRate = roster.length > 0 ? Math.round(((presentCount + lateCount) / roster.length) * 100) : 0

  return (
    <>
      {/* Session KPI Summary Cards */}
      <div className="attendance-kpi-grid">
        <div className="attendance-kpi-card rate">
          <span className="kpi-label">Session Turnout</span>
          <span className="kpi-value">{sessionRate}%</span>
          <span className="kpi-sub">{presentCount + lateCount} of {roster.length} attended</span>
        </div>
        <div className="attendance-kpi-card present">
          <span className="kpi-label">Present</span>
          <span className="kpi-value">{presentCount}</span>
          <span className="kpi-sub">{roster.length ? Math.round((presentCount / roster.length) * 100) : 0}% of class</span>
        </div>
        <div className="attendance-kpi-card late">
          <span className="kpi-label">Late</span>
          <span className="kpi-value">{lateCount}</span>
          <span className="kpi-sub">Attended with delay</span>
        </div>
        <div className="attendance-kpi-card excused">
          <span className="kpi-label">Excused</span>
          <span className="kpi-value">{excusedCount}</span>
          <span className="kpi-sub">Authorized absence</span>
        </div>
        <div className="attendance-kpi-card absent">
          <span className="kpi-label">Absent</span>
          <span className="kpi-value">{absentCount}</span>
          <span className="kpi-sub">{unmarkedCount} still unmarked</span>
        </div>
      </div>

      {/* Roster Controls & Filters */}
      <div className="attendance-toolbar" style={{ flexWrap: 'wrap', gap: '10px' }}>
        <label className="attendance-search" style={{ flex: '1 1 240px' }}>
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search learners by name or email"
            aria-label="Search members"
          />
        </label>

        <div className="attendance-quick-actions">
          {readOnly ? (
            <button
              type="button"
              className="button button-ghost button-compact"
              onClick={() => setEditing(true)}
            >
              <Pencil size={14} /> Edit Attendance
            </button>
          ) : (
            <>
              <button
                type="button"
                className="button button-ghost button-compact"
                onClick={() => markAllVisible('present')}
                disabled={!visible.length}
                title="Mark all matching students as present"
              >
                <Check size={14} /> Mark All Present
              </button>
              <button
                type="button"
                className="button button-ghost button-compact"
                onClick={() => markAllVisible('absent')}
                disabled={!visible.length}
              >
                Mark All Absent
              </button>
              {unmarkedCount > 0 && (
                <button
                  type="button"
                  className="button button-ghost button-compact"
                  onClick={fillUnmarkedAbsent}
                >
                  Fill Unmarked Absent
                </button>
              )}
            </>
          )}

          <button
            type="button"
            className="button button-ghost button-compact"
            onClick={() => setIsWalkInOpen(true)}
          >
            <UserPlus size={14} /> Add Student
          </button>

          <button
            type="button"
            className="button button-ghost button-compact"
            onClick={() => exportSessionToCsv({ courseTitle, session, roster })}
            title="Download CSV spreadsheet of this roll call"
          >
            <Download size={14} /> Export CSV
          </button>

          <button
            type="button"
            className="button button-ghost button-compact"
            onClick={async () => {
              await copySessionRosterToClipboard({ courseTitle, session, roster })
              toast.success('Roster copied! You can now paste directly into Excel or Google Sheets.')
            }}
            title="Copy for Google Sheets or Excel"
          >
            <Copy size={14} /> Copy
          </button>
        </div>
      </div>

      {/* Filter Pills */}
      <div className="attendance-filter-pills" style={{ marginBottom: '14px' }}>
        <button
          type="button"
          className={`attendance-filter-pill ${statusFilter === 'all' ? 'active' : ''}`}
          onClick={() => setStatusFilter('all')}
        >
          All ({roster.length})
        </button>
        <button
          type="button"
          className={`attendance-filter-pill ${statusFilter === 'present' ? 'active' : ''}`}
          onClick={() => setStatusFilter('present')}
        >
          Present ({presentCount})
        </button>
        <button
          type="button"
          className={`attendance-filter-pill ${statusFilter === 'late' ? 'active' : ''}`}
          onClick={() => setStatusFilter('late')}
        >
          Late ({lateCount})
        </button>
        <button
          type="button"
          className={`attendance-filter-pill ${statusFilter === 'excused' ? 'active' : ''}`}
          onClick={() => setStatusFilter('excused')}
        >
          Excused ({excusedCount})
        </button>
        <button
          type="button"
          className={`attendance-filter-pill ${statusFilter === 'absent' ? 'active' : ''}`}
          onClick={() => setStatusFilter('absent')}
        >
          Absent ({absentCount})
        </button>
        {unmarkedCount > 0 && (
          <button
            type="button"
            className={`attendance-filter-pill ${statusFilter === 'unmarked' ? 'active' : ''}`}
            onClick={() => setStatusFilter('unmarked')}
          >
            Unmarked ({unmarkedCount})
          </button>
        )}
      </div>

      {/* Roster Listing */}
      <div className="attendance-roster">
        {!visible.length && (
          <p className="operations-note">
            {search.trim() || statusFilter !== 'all'
              ? 'No learners match the current filter.'
              : 'No learners have access to this course yet.'}
          </p>
        )}
        {visible.map((row) => (
          <div className="attendance-row" key={row.learnerId}>
            <span
              className="attendance-member"
              style={{ cursor: 'pointer' }}
              onClick={() => setSelectedStudentForHistory({ ...row, stats: { attendanceRate: 100 } })}
              title="Click to view full attendance history"
            >
              <span className="avatar">
                {(row.name ?? '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
              </span>
              <span>
                <strong>{row.name}</strong>
                <small>{row.email}</small>
              </span>
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {/* Remarks button */}
              <button
                type="button"
                className={`attendance-remarks-btn ${row.remarks ? 'has-remark' : ''}`}
                onClick={() => setActiveRemarkStudent(row)}
                title={row.remarks ? `Note: ${row.remarks}` : 'Add note/excuse for this student'}
              >
                <MessageSquare size={12} />
                <span>{row.remarks ? row.remarks : '+ Note'}</span>
              </button>

              {/* Status pills */}
              {readOnly ? (
                <span className={`attendance-status-tag ${row.status ?? 'unmarked'}`}>
                  {statusLabel[row.status] ?? 'Not marked'}
                </span>
              ) : (
                <div className="attendance-status-group">
                  {attendanceStatuses.map((st) => (
                    <button
                      type="button"
                      key={st.value}
                      className={`attendance-status-pill ${st.value} ${row.status === st.value ? 'active' : ''}`}
                      onClick={() => setStatus(row.learnerId, st.value)}
                      aria-pressed={row.status === st.value}
                    >
                      {st.label}
                    </button>
                  ))}
                  {row.status && (
                    <button
                      type="button"
                      className="button button-ghost button-compact"
                      style={{ padding: '3px 6px', fontSize: '10px' }}
                      onClick={() => {
                        setStatus(row.learnerId, null)
                        deleteRecordMutation.mutate(row.learnerId)
                      }}
                      title="Clear mark"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Submit / Save Bar */}
      <div className="attendance-submit-row">
        <span className="attendance-count">
          {markedCount} of {roster.length} marked ({sessionRate}% turnout)
          {dirty ? ' · unsaved changes' : ''}
        </span>
        {readOnly ? (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="button button-ghost button-compact"
              style={{ color: '#b0392c' }}
              onClick={handleResetSession}
              disabled={resetMutation.isPending}
            >
              <RotateCcw size={14} /> Reset Roll Call
            </button>
            <button
              type="button"
              className="button button-primary button-compact"
              onClick={() => setEditing(true)}
            >
              <Pencil size={14} /> Edit Attendance
            </button>
          </div>
        ) : (
          <span className="attendance-actions">
            {isRecorded && (
              <button
                type="button"
                className="button button-ghost button-compact"
                onClick={cancelEdit}
                disabled={mutation.isPending}
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              className="button button-primary button-compact"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              <Check size={14} /> {mutation.isPending ? 'Saving…' : isRecorded ? 'Save Changes' : 'Save Attendance'}
            </button>
          </span>
        )}
      </div>

      {/* Modals */}
      <RemarkModal
        isOpen={Boolean(activeRemarkStudent)}
        student={activeRemarkStudent}
        onClose={() => setActiveRemarkStudent(null)}
        onSave={setStudentRemark}
      />

      <WalkInModal
        isOpen={isWalkInOpen}
        onClose={() => setIsWalkInOpen(false)}
        session={session}
        existingLearnerIds={roster.map((r) => r.learnerId)}
        onStudentAdded={() => {
          queryClient.invalidateQueries({ queryKey: ['event-attendance', session.id] })
        }}
      />

      <StudentHistoryModal
        isOpen={Boolean(selectedStudentForHistory)}
        onClose={() => setSelectedStudentForHistory(null)}
        learner={selectedStudentForHistory}
        sessions={[session]}
        onRecordUpdated={() => {
          queryClient.invalidateQueries({ queryKey: ['event-attendance', session.id] })
        }}
      />
    </>
  )
}

// Program Master Sheet Matrix Component
function MasterAttendanceMatrix({ courseId, courseTitle, onOpenSession }) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [standingFilter, setStandingFilter] = useState('all')
  const [selectedLearner, setSelectedLearner] = useState(null)

  const { data: summary, isLoading, isError, error } = useQuery({
    queryKey: ['course-attendance-summary', courseId],
    queryFn: () => fetchCourseAttendanceSummary(courseId),
    enabled: Boolean(courseId),
  })

  const learners = useMemo(() => summary?.learners || [], [summary?.learners])
  const sessions = useMemo(() => summary?.sessions || [], [summary?.sessions])
  const analytics = useMemo(() => summary?.analytics || {}, [summary?.analytics])

  const filteredLearners = useMemo(() => {
    let list = learners
    if (standingFilter !== 'all') {
      list = list.filter((l) => l.stats.standing === standingFilter)
    }
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((l) => l.name.toLowerCase().includes(q) || l.email.toLowerCase().includes(q))
  }, [learners, search, standingFilter])

  if (isLoading) return <Loading block label="Generating master attendance spreadsheet…" />
  if (isError) return <p className="form-alert" role="alert">{error?.message || 'Could not load summary.'}</p>
  if (!sessions.length) {
    return (
      <div className="empty-state">
        <CalendarDays size={26} />
        <strong>No sessions recorded yet</strong>
        <p>Create class review sessions on the Roll Call tab to build your attendance matrix.</p>
      </div>
    )
  }

  return (
    <>
      {/* Program Summary Cards */}
      <div className="attendance-kpi-grid">
        <div className="attendance-kpi-card rate">
          <span className="kpi-label">Program Attendance</span>
          <span className="kpi-value">{analytics.overallAttendanceRate ?? 0}%</span>
          <span className="kpi-sub">Across all {analytics.recordedSessions ?? 0} held sessions</span>
        </div>
        <div className="attendance-kpi-card">
          <span className="kpi-label">Sessions Held</span>
          <span className="kpi-value">{analytics.recordedSessions ?? 0}</span>
          <span className="kpi-sub">{analytics.totalSessions ?? 0} total scheduled</span>
        </div>
        <div className="attendance-kpi-card">
          <span className="kpi-label">Enrolled Learners</span>
          <span className="kpi-value">{analytics.totalLearners ?? 0}</span>
          <span className="kpi-sub">Active program roster</span>
        </div>
        <div className="attendance-kpi-card present">
          <span className="kpi-label">Perfect Attendance</span>
          <span className="kpi-value">{analytics.perfectAttendanceCount ?? 0}</span>
          <span className="kpi-sub">0 absences recorded</span>
        </div>
        <div className="attendance-kpi-card absent">
          <span className="kpi-label">At-Risk Learners</span>
          <span className="kpi-value">{analytics.atRiskCount ?? 0}</span>
          <span className="kpi-sub">&lt; 80% attendance rate</span>
        </div>
      </div>

      {/* Matrix Toolbar */}
      <div className="attendance-toolbar" style={{ flexWrap: 'wrap', gap: '10px' }}>
        <label className="attendance-search" style={{ flex: '1 1 240px' }}>
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search students in matrix…"
          />
        </label>

        <div className="attendance-filter-pills">
          <button
            type="button"
            className={`attendance-filter-pill ${standingFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStandingFilter('all')}
          >
            All Students ({learners.length})
          </button>
          <button
            type="button"
            className={`attendance-filter-pill ${standingFilter === 'good' ? 'active' : ''}`}
            onClick={() => setStandingFilter('good')}
          >
            Good Standing (&ge;80%)
          </button>
          <button
            type="button"
            className={`attendance-filter-pill ${standingFilter === 'warning' ? 'active' : ''}`}
            onClick={() => setStandingFilter('warning')}
          >
            Needs Attention (60-79%)
          </button>
          <button
            type="button"
            className={`attendance-filter-pill ${standingFilter === 'critical' ? 'active' : ''}`}
            onClick={() => setStandingFilter('critical')}
          >
            Critical (&lt;60%)
          </button>
        </div>

        <button
          type="button"
          className="button button-primary button-compact"
          onClick={() => exportMasterMatrixToCsv({ courseTitle, summary })}
        >
          <Download size={14} /> Export Master Matrix (.csv)
        </button>
      </div>

      {/* Spreadsheet Matrix Table */}
      <div className="attendance-matrix-container">
        <table className="attendance-matrix-table">
          <thead>
            <tr>
              <th className="sticky-col">Student Name &amp; Email</th>
              <th>Overall Rate</th>
              <th>P</th>
              <th>L</th>
              <th>E</th>
              <th>A</th>
              {sessions.map((s) => {
                const sDate = s.startsAt ? new Date(s.startsAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : ''
                return (
                  <th
                    key={s.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onOpenSession(s.id, localDateValue(s.startsAt))}
                    title={`Click to open session roll call: ${s.title}`}
                  >
                    <div>{s.title}</div>
                    <small style={{ fontWeight: 400, color: '#8a9088' }}>{sDate}</small>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {!filteredLearners.length ? (
              <tr>
                <td colSpan={6 + sessions.length} style={{ padding: '24px', textAlign: 'center', color: '#8a9088' }}>
                  No students match the selected filter.
                </td>
              </tr>
            ) : (
              filteredLearners.map((learner) => (
                <tr key={learner.learnerId}>
                  <td
                    className="sticky-col"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedLearner(learner)}
                    title="Click to view learner attendance history"
                  >
                    <div style={{ fontWeight: 700, color: 'var(--forest)' }}>{learner.name}</div>
                    <div style={{ fontSize: '11px', color: '#8a9088' }}>{learner.email}</div>
                  </td>
                  <td>
                    <span className={`attendance-standing-badge ${learner.stats.standing}`}>
                      {learner.stats.attendanceRate}%
                    </span>
                  </td>
                  <td style={{ color: '#2f6a41', fontWeight: 700 }}>{learner.stats.present}</td>
                  <td style={{ color: '#8a6b26', fontWeight: 700 }}>{learner.stats.late}</td>
                  <td style={{ color: '#3f5f80', fontWeight: 700 }}>{learner.stats.excused}</td>
                  <td style={{ color: '#8a2e23', fontWeight: 700 }}>{learner.stats.absent}</td>
                  {sessions.map((s) => {
                    const rec = learner.records?.[s.id]
                    const letter = !rec ? 'U' : rec.status === 'present' ? 'P' : rec.status === 'late' ? 'L' : rec.status === 'excused' ? 'E' : 'A'
                    const tip = !rec
                      ? 'Not marked'
                      : `${statusLabel[rec.status]}${rec.remarks ? ` — Note: ${rec.remarks}` : ''}`
                    return (
                      <td key={s.id}>
                        <span
                          className={`attendance-matrix-cell ${letter}`}
                          title={tip}
                          onClick={() => setSelectedLearner(learner)}
                        >
                          {letter === 'U' ? '—' : letter}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className="sticky-col">Turnout Rate</td>
              <td>{analytics.overallAttendanceRate ?? 0}%</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
              {sessions.map((s) => (
                <td key={s.id} style={{ fontWeight: 800, color: 'var(--forest)' }}>
                  {s.attendanceRate !== null ? `${s.attendanceRate}%` : '—'}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <StudentHistoryModal
        isOpen={Boolean(selectedLearner)}
        onClose={() => setSelectedLearner(null)}
        learner={selectedLearner}
        sessions={sessions}
        onRecordUpdated={() => {
          queryClient.invalidateQueries({ queryKey: ['course-attendance-summary', courseId] })
        }}
      />
    </>
  )
}

// Attendance Analytics & At-Risk Insights Component
function AttendanceAnalyticsView({ courseId, onOpenStudent }) {
  const { data: summary, isLoading, isError, error } = useQuery({
    queryKey: ['course-attendance-summary', courseId],
    queryFn: () => fetchCourseAttendanceSummary(courseId),
    enabled: Boolean(courseId),
  })

  if (isLoading) return <Loading block label="Calculating attendance statistics…" />
  if (isError) return <p className="form-alert" role="alert">{error?.message || 'Could not load analytics.'}</p>

  const { analytics = {}, learners = [], sessions = [] } = summary || {}
  const atRiskLearners = learners.filter((l) => l.stats.standing === 'critical' || l.stats.standing === 'warning')

  return (
    <div style={{ display: 'grid', gap: '20px' }}>
      <div className="attendance-kpi-grid">
        <div className="attendance-kpi-card rate">
          <span className="kpi-label">Cohort Attendance Rate</span>
          <span className="kpi-value">{analytics.overallAttendanceRate ?? 0}%</span>
          <span className="kpi-sub">Overall academy benchmark: 85%</span>
        </div>
        <div className="attendance-kpi-card">
          <span className="kpi-label">Total Sessions</span>
          <span className="kpi-value">{analytics.recordedSessions ?? 0}</span>
          <span className="kpi-sub">Recorded roll calls</span>
        </div>
        <div className="attendance-kpi-card present">
          <span className="kpi-label">Perfect Attendance</span>
          <span className="kpi-value">{analytics.perfectAttendanceCount ?? 0}</span>
          <span className="kpi-sub">Learners with 100% record</span>
        </div>
        <div className="attendance-kpi-card absent">
          <span className="kpi-label">At-Risk Learners</span>
          <span className="kpi-value">{atRiskLearners.length}</span>
          <span className="kpi-sub">Requiring academic follow-up</span>
        </div>
      </div>

      {/* At-Risk Students Section */}
      <div className="attendance-card" style={{ marginTop: 0 }}>
        <div className="attendance-card-head">
          <div>
            <p className="eyebrow" style={{ color: '#b0392c' }}>EARLY INTERVENTION ALERT</p>
            <h2>At-Risk &amp; Low Attendance Learners</h2>
            <small>Students with 2+ absences or attendance rate below 80%</small>
          </div>
          <span className="attendance-state pending">
            <AlertTriangle size={14} /> {atRiskLearners.length} flagged
          </span>
        </div>

        {!atRiskLearners.length ? (
          <p className="operations-note" style={{ color: '#2f6a41' }}>
            <CheckCircle2 size={16} /> Excellent! All enrolled students are in good attendance standing.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: '8px' }}>
            {atRiskLearners.map((learner) => (
              <div key={learner.learnerId} className="attendance-at-risk-card">
                <div className="attendance-at-risk-info">
                  <span className="avatar">
                    {(learner.name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                  </span>
                  <div>
                    <strong>{learner.name}</strong>
                    <div style={{ fontSize: '11px', color: '#8a9088' }}>{learner.email}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span className={`attendance-standing-badge ${learner.stats.standing}`}>
                    {learner.stats.attendanceRate}% ({learner.stats.absent} missed)
                  </span>
                  <button
                    type="button"
                    className="button button-ghost button-compact"
                    onClick={() => onOpenStudent(learner)}
                  >
                    View History
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Session Breakdown Section */}
      <div className="attendance-card" style={{ marginTop: 0 }}>
        <div className="attendance-card-head">
          <div>
            <p className="eyebrow">SESSION BY SESSION TURNOUT</p>
            <h2>Attendance History &amp; Participation</h2>
            <small>Review attendance rates per live session</small>
          </div>
        </div>

        {!sessions.length ? (
          <p className="operations-note">No sessions recorded yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: '10px' }}>
            {sessions.map((s) => {
              const dateStr = s.startsAt ? new Date(s.startsAt).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : ''
              const rate = s.attendanceRate ?? 0
              return (
                <div
                  key={s.id}
                  style={{
                    padding: '12px 14px',
                    background: '#f7faf6',
                    border: '1px solid #edf0ec',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                  }}
                >
                  <div style={{ flex: '1 1 200px' }}>
                    <strong>{s.title}</strong>
                    <div style={{ fontSize: '11px', color: '#8a9088' }}>{dateStr} · {timeLabel(s.startsAt)}</div>
                  </div>
                  <div style={{ flex: '1 1 200px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ flex: 1, height: '8px', background: '#e2e8e0', borderRadius: '999px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${rate}%`,
                          background: rate >= 80 ? '#4f9463' : rate >= 60 ? '#c99a3f' : '#b0392c',
                          borderRadius: '999px',
                        }}
                      />
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: 800, minWidth: '40px' }}>{rate}%</span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <span className="attendance-status-tag present">{s.present} P</span>
                    <span className="attendance-status-tag late">{s.late} L</span>
                    <span className="attendance-status-tag absent">{s.absent} A</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default function AttendancePage({ role }) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState('roll_call') // 'roll_call', 'matrix', 'analytics'
  const [courseId, setCourseId] = useState('')
  const [date, setDate] = useState(todayValue)
  const [sessionId, setSessionId] = useState('')
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false)
  const [sessionToEdit, setSessionToEdit] = useState(null)
  const [analyticsSelectedStudent, setAnalyticsSelectedStudent] = useState(null)

  const { data: courses = [], isLoading: coursesLoading } = useQuery({
    queryKey: ['courses'],
    queryFn: fetchCourses,
    enabled: role !== 'learner',
  })

  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ['calendar'],
    queryFn: () => fetchCalendar(),
    enabled: role !== 'learner',
  })

  const activeCourseId = courseId || courses[0]?._id || ''
  const activeCourse = courses.find((course) => course._id === activeCourseId)

  // Sessions for the selected program on the selected day
  const sessions = useMemo(() => events
    .filter((event) => sessionTypes.includes(event.eventType) && String(event.courseId ?? '') === String(activeCourseId) && localDateValue(event.startsAt) === date)
    .sort((first, second) => new Date(first.startsAt) - new Date(second.startsAt))
    .map((event) => ({
      id: event._id ?? event.id,
      title: event.title,
      description: event.description,
      meetingUrl: event.meetingUrl,
      eventType: event.eventType,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
    })), [events, activeCourseId, date])

  const activeSession = sessions.find((session) => session.id === sessionId) ?? (sessions.length === 1 ? sessions[0] : null)

  const { data: attendance } = useQuery({
    queryKey: ['event-attendance', activeSession?.id],
    queryFn: () => fetchEventAttendance(activeSession.id),
    enabled: Boolean(activeSession?.id),
  })

  const { data: summaryData } = useQuery({
    queryKey: ['course-attendance-summary', activeCourseId],
    queryFn: () => fetchCourseAttendanceSummary(activeCourseId),
    enabled: Boolean(activeCourseId),
  })

  const deleteSessionMutation = useMutation({
    mutationFn: (id) => deleteCalendarEvent(id),
    onSuccess: () => {
      toast.success('Session and its attendance records were deleted.')
      setSessionId('')
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
      queryClient.invalidateQueries({ queryKey: ['course-attendance-summary'] })
    },
    onError: (err) => toast.error(err.message),
  })

  const handleDeleteSession = (session) => {
    if (window.confirm(`Are you sure you want to delete the session "${session.title}"? This will permanently delete its attendance records.`)) {
      deleteSessionMutation.mutate(session.id)
    }
  }

  const navigateDate = (deltaDays) => {
    const current = new Date(`${date}T00:00:00`)
    current.setDate(current.getDate() + deltaDays)
    const newDateStr = current.toISOString().slice(0, 10)
    setDate(newDateStr)
    setSessionId('')
  }

  const handleOpenSessionFromMatrix = (targetSessionId, targetDate) => {
    if (targetDate) setDate(targetDate)
    setSessionId(targetSessionId)
    setActiveTab('roll_call')
  }

  if (role === 'learner') {
    return <p className="operations-note">Attendance is available to instructors and administrators only.</p>
  }

  return (
    <>
      {/* Page Header */}
      <div className="page-title-row" style={{ flexWrap: 'wrap', gap: '14px', alignItems: 'flex-start' }}>
        <div>
          <p className="eyebrow">TEACHING WORKSPACE</p>
          <h1>Attendance &amp; Roll Call</h1>
          <p>Record daily session roll calls, track student engagement, and export attendance spreadsheets.</p>
        </div>
        <div className="attendance-header-actions">
          <button
            type="button"
            className="button button-ghost button-compact"
            onClick={() => {
              if (activeTab === 'matrix' || !activeSession) {
                if (summaryData) exportMasterMatrixToCsv({ courseTitle: activeCourse?.title, summary: summaryData })
              } else if (attendance?.roster) {
                exportSessionToCsv({ courseTitle: activeCourse?.title, session: activeSession, roster: attendance.roster })
              }
            }}
          >
            <Download size={14} /> Export Spreadsheet (.csv)
          </button>
          <button
            type="button"
            className="button button-primary button-compact"
            onClick={() => {
              setSessionToEdit(null)
              setIsSessionModalOpen(true)
            }}
          >
            <Plus size={14} /> New Session
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="attendance-tabs">
        <button
          type="button"
          className={`attendance-tab ${activeTab === 'roll_call' ? 'active' : ''}`}
          onClick={() => setActiveTab('roll_call')}
        >
          <UserCheck size={16} /> Daily Roll Call
        </button>
        <button
          type="button"
          className={`attendance-tab ${activeTab === 'matrix' ? 'active' : ''}`}
          onClick={() => setActiveTab('matrix')}
        >
          <FileSpreadsheet size={16} /> Program Master Sheet
        </button>
        <button
          type="button"
          className={`attendance-tab ${activeTab === 'analytics' ? 'active' : ''}`}
          onClick={() => setActiveTab('analytics')}
        >
          <TrendingUp size={16} /> Analytics &amp; At-Risk
        </button>
      </div>

      {/* Main Content Areas */}
      {activeTab === 'roll_call' && (
        <>
          {/* Program, Date & Session Filters */}
          <div className="attendance-filters">
            <label className="builder-field">
              <span>Program</span>
              <select
                value={activeCourseId}
                onChange={(e) => {
                  setCourseId(e.target.value)
                  setSessionId('')
                }}
                aria-label="Select program"
                disabled={coursesLoading || !courses.length}
              >
                {!courses.length && <option value="">No programs available</option>}
                {courses.map((course) => (
                  <option key={course._id} value={course._id}>
                    {course.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="builder-field">
              <span>Date</span>
              <div className="attendance-date-nav">
                <button
                  type="button"
                  className="button button-ghost button-compact"
                  onClick={() => navigateDate(-1)}
                  title="Previous Day"
                >
                  <ChevronLeft size={14} />
                </button>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value)
                    setSessionId('')
                  }}
                  aria-label="Attendance date"
                />
                <button
                  type="button"
                  className="button button-ghost button-compact"
                  onClick={() => navigateDate(1)}
                  title="Next Day"
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  type="button"
                  className="button button-ghost button-compact"
                  onClick={() => {
                    setDate(todayValue())
                    setSessionId('')
                  }}
                  title="Jump to Today"
                >
                  Today
                </button>
              </div>
            </label>

            <label className="builder-field">
              <span>Session {sessions.length > 1 ? '' : '(optional)'}</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <select
                  style={{ flex: 1 }}
                  value={activeSession?.id ?? ''}
                  onChange={(e) => setSessionId(e.target.value)}
                  aria-label="Select session"
                  disabled={!sessions.length}
                >
                  {!sessions.length && <option value="">No session on this date</option>}
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {timeLabel(session.startsAt)} · {session.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button button-ghost button-compact"
                  onClick={() => {
                    setSessionToEdit(null)
                    setIsSessionModalOpen(true)
                  }}
                  title="Add session on this date"
                >
                  <Plus size={14} />
                </button>
              </div>
            </label>
          </div>

          {coursesLoading || eventsLoading ? (
            <Loading block label="Loading programs…" />
          ) : !courses.length ? (
            <div className="empty-state">
              <CalendarDays size={26} />
              <strong>No programs yet</strong>
              <p>Create a course before taking attendance.</p>
            </div>
          ) : (
            <div className="attendance-card">
              <div className="attendance-card-head">
                <div>
                  <p className="eyebrow">{activeCourse?.title ?? 'Program'}</p>
                  <h2>{dateLabel(date)}</h2>
                  {activeSession && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                      <small style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#556054' }}>
                        <Clock size={12} /> {timeLabel(activeSession.startsAt)}
                        {activeSession.endsAt ? ` – ${timeLabel(activeSession.endsAt)}` : ''} ·{' '}
                        <strong>{activeSession.title}</strong>
                      </small>
                      {activeSession.meetingUrl && (
                        <a
                          href={activeSession.meetingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '11px',
                            color: 'var(--forest)',
                            fontWeight: 700,
                            textDecoration: 'underline',
                          }}
                        >
                          <ExternalLink size={11} /> Join Meeting
                        </a>
                      )}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {activeSession && (
                    <>
                      <button
                        type="button"
                        className="button button-ghost button-compact"
                        onClick={() => {
                          setSessionToEdit(activeSession)
                          setIsSessionModalOpen(true)
                        }}
                        title="Edit session details"
                      >
                        <Pencil size={13} /> Edit
                      </button>
                      <button
                        type="button"
                        className="button button-ghost button-compact"
                        style={{ color: '#b0392c' }}
                        onClick={() => handleDeleteSession(activeSession)}
                        title="Delete session"
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    </>
                  )}
                  {activeSession &&
                    (attendance?.recordedAt ? (
                      <span className="attendance-state recorded">
                        <CheckCircle2 size={14} /> Recorded{' '}
                        {new Date(attendance.recordedAt).toLocaleString('en-PH', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </span>
                    ) : (
                      <span className="attendance-state pending">
                        <CalendarDays size={14} /> Not yet recorded
                      </span>
                    ))}
                </div>
              </div>

              {!sessions.length && (
                <div className="attendance-empty">
                  <p className="operations-note">
                    <CalendarDays size={17} /> No session is scheduled for {activeCourse?.title ?? 'this program'} on this date.
                  </p>
                  <button
                    type="button"
                    className="button button-primary button-compact"
                    onClick={() => {
                      setSessionToEdit(null)
                      setIsSessionModalOpen(true)
                    }}
                  >
                    <Plus size={14} /> Create a session for this date
                  </button>
                </div>
              )}

              {sessions.length > 1 && !sessionId && (
                <p className="operations-note">
                  This date has {sessions.length} sessions — choose one above to take its roll call.
                </p>
              )}

              {activeSession && (
                <RollCall
                  key={activeSession.id}
                  session={activeSession}
                  courseTitle={activeCourse?.title}
                  onSaved={() => {
                    queryClient.invalidateQueries({ queryKey: ['calendar'] })
                    queryClient.invalidateQueries({ queryKey: ['course-attendance-summary'] })
                  }}
                  onSessionChangeRequested={() => {
                    setSessionToEdit(activeSession)
                    setIsSessionModalOpen(true)
                  }}
                />
              )}
            </div>
          )}
        </>
      )}

      {activeTab === 'matrix' && (
        <div className="attendance-card" style={{ marginTop: '20px' }}>
          <div className="attendance-card-head">
            <div>
              <p className="eyebrow">{activeCourse?.title || 'Program'} MATRIX</p>
              <h2>Program Attendance Master Sheet</h2>
              <small>Comprehensive attendance matrix across all review sessions for this cohort.</small>
            </div>
          </div>
          <MasterAttendanceMatrix
            courseId={activeCourseId}
            courseTitle={activeCourse?.title}
            onOpenSession={handleOpenSessionFromMatrix}
          />
        </div>
      )}

      {activeTab === 'analytics' && (
        <div style={{ marginTop: '20px' }}>
          <AttendanceAnalyticsView
            courseId={activeCourseId}
            onOpenStudent={(learner) => setAnalyticsSelectedStudent(learner)}
          />
        </div>
      )}

      {/* Global Modals */}
      <SessionModal
        isOpen={isSessionModalOpen}
        onClose={() => {
          setIsSessionModalOpen(false)
          setSessionToEdit(null)
        }}
        courseId={activeCourseId}
        date={date}
        session={sessionToEdit}
        onSaved={(event) => {
          queryClient.invalidateQueries({ queryKey: ['calendar'] })
          queryClient.invalidateQueries({ queryKey: ['course-attendance-summary'] })
          setSessionId(event._id ?? event.id)
        }}
      />

      <StudentHistoryModal
        isOpen={Boolean(analyticsSelectedStudent)}
        onClose={() => setAnalyticsSelectedStudent(null)}
        learner={analyticsSelectedStudent}
        sessions={summaryData?.sessions || []}
        onRecordUpdated={() => {
          queryClient.invalidateQueries({ queryKey: ['course-attendance-summary', activeCourseId] })
          queryClient.invalidateQueries({ queryKey: ['event-attendance'] })
        }}
      />
    </>
  )
}
