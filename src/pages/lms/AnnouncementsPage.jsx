import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Edit3, Globe, Mail, Megaphone, Pin, Plus, Trash2 } from 'lucide-react'
import { useConfirm } from '../../lib/confirmContext.js'
import { useToast } from '../../lib/toastContext.js'
import {
  createStaffAnnouncement,
  deleteAnnouncement,
  fetchAnnouncements,
  fetchCourses,
  updateAnnouncement,
} from '../../lib/lms.js'
import Loading from '../../components/Loading.jsx'

const when = (value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function ComposeForm({ courses, initialAnnouncement, role, onDone, onCancel }) {
  const isEditing = Boolean(initialAnnouncement)
  const [values, setValues] = useState({
    courseId: initialAnnouncement?.courseId ?? (courses[0]?._id ? String(courses[0]._id) : ''),
    title: initialAnnouncement?.title ?? '',
    body: initialAnnouncement?.body ?? '',
    pinned: initialAnnouncement?.pinned ?? false,
    sendEmail: true,
  })
  const [error, setError] = useState('')
  const toast = useToast()

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        courseId: values.courseId || null,
        title: values.title.trim(),
        body: values.body.trim(),
        pinned: values.pinned,
        sendEmail: values.sendEmail,
      }
      return isEditing
        ? updateAnnouncement(initialAnnouncement.id, payload)
        : createStaffAnnouncement(payload)
    },
  })

  const submit = async (event) => {
    event.preventDefault()
    if (values.title.trim().length < 2 || values.body.trim().length < 2) {
      setError('Add a title and a message.')
      return
    }
    setError('')
    try {
      await mutation.mutateAsync()
      toast.success(isEditing ? 'Announcement updated.' : 'Announcement posted.')
      onDone()
    } catch (e) {
      setError(e.message || 'Failed to save announcement.')
    }
  }

  return (
    <form className="announce-form" onSubmit={submit}>
      <select
        value={values.courseId}
        onChange={(event) => setValues((prev) => ({ ...prev, courseId: event.target.value }))}
        aria-label="Course"
      >
        {role === 'admin' && <option value="">All Programs (Academy-Wide)</option>}
        {courses.map((course) => (
          <option key={course._id} value={course._id}>
            {course.title}
          </option>
        ))}
      </select>
      <input
        value={values.title}
        onChange={(event) => setValues((prev) => ({ ...prev, title: event.target.value }))}
        placeholder="Announcement title"
        aria-label="Title"
        maxLength={160}
      />
      <textarea
        value={values.body}
        onChange={(event) => setValues((prev) => ({ ...prev, body: event.target.value }))}
        placeholder="Write your message to the class…"
        rows={4}
        maxLength={4000}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', margin: '4px 0' }}>
        <label className="builder-publish-check" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={values.pinned}
            onChange={(event) => setValues((prev) => ({ ...prev, pinned: event.target.checked }))}
          />
          <Pin size={13} /> Pin to top
        </label>
        <label className="builder-publish-check" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={values.sendEmail}
            onChange={(event) => setValues((prev) => ({ ...prev, sendEmail: event.target.checked }))}
          />
          <Mail size={13} /> {isEditing ? 'Resend email update' : 'Send email notification to enrolled learners'}
        </label>
      </div>
      <div className="announce-form-foot">
        <div />
        <div className="builder-lesson-actions">
          <button className="button button-primary button-compact" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : isEditing ? 'Update announcement' : 'Post announcement'}
          </button>
          <button type="button" className="button button-ghost button-compact" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
      {error && <span className="builder-error">{error}</span>}
    </form>
  )
}

export default function AnnouncementsPage({ role, user }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const isStaff = role !== 'learner'
  const [composing, setComposing] = useState(false)
  const [editingAnnouncement, setEditingAnnouncement] = useState(null)

  const handleBack = () => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1)
    } else {
      navigate('/notifications')
    }
  }

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => fetchAnnouncements(),
  })
  const { data: courses = [] } = useQuery({
    queryKey: ['courses'],
    queryFn: fetchCourses,
    enabled: isStaff,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['announcements'] })

  const remove = async (announcement) => {
    if (
      !(await confirm({
        title: 'Delete this announcement?',
        message: `“${announcement.title}” will be removed for everyone.`,
        confirmLabel: 'Delete announcement',
        danger: true,
      }))
    )
      return
    try {
      await deleteAnnouncement(announcement.id)
      toast.success('Announcement deleted.')
      refresh()
    } catch (e) {
      toast.error(e.message || 'Failed to delete announcement.')
    }
  }

  // Admins moderate every announcement; instructors may edit/remove their own
  const canModify = (announcement) => role === 'admin' || announcement.authorId === user?.id

  return (
    <>
      <button
        type="button"
        className="filter-button"
        onClick={handleBack}
        style={{ marginBottom: 18, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
        aria-label="Back"
      >
        <ArrowLeft size={15} /> Back
      </button>

      <div className="page-title-row">
        <div>
          <p className="eyebrow">{isStaff ? 'TEACHING & COMMUNICATIONS' : 'YOUR CLASSES'}</p>
          <h1>Announcements</h1>
          <p>
            {isStaff
              ? 'Post announcements to your course or academy-wide — enrolled learners are notified automatically in-app and by email.'
              : 'Updates from your instructors and academy administration, newest first.'}
          </p>
        </div>
        {isStaff && courses.length > 0 && !composing && !editingAnnouncement && (
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              setEditingAnnouncement(null)
              setComposing(true)
            }}
          >
            <Plus size={16} /> New announcement
          </button>
        )}
      </div>

      {(composing || editingAnnouncement) && (
        <ComposeForm
          courses={courses}
          initialAnnouncement={editingAnnouncement}
          role={role}
          onDone={() => {
            refresh()
            setComposing(false)
            setEditingAnnouncement(null)
          }}
          onCancel={() => {
            setComposing(false)
            setEditingAnnouncement(null)
          }}
        />
      )}

      <div className="announce-list">
        {isLoading ? (
          <Loading label="Loading announcements…" />
        ) : !announcements.length ? (
          <p className="operations-note">
            <Megaphone size={17} /> No announcements yet.
          </p>
        ) : (
          announcements.map((announcement) => (
            <article className={`announce-card ${announcement.pinned ? 'pinned' : ''}`} key={announcement.id}>
              <div className="announce-head">
                <div>
                  <small style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {!announcement.courseId && <Globe size={11} />}
                    {announcement.courseTitle.toUpperCase()}
                  </small>
                  <h3>
                    {announcement.pinned && <Pin size={13} />} {announcement.title}
                  </h3>
                </div>
                <span className="announce-meta">
                  {announcement.authorName} · {when(announcement.createdAt)}
                  {isStaff && canModify(announcement) && (
                    <span style={{ display: 'inline-flex', gap: 4, marginLeft: 8 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setComposing(false)
                          setEditingAnnouncement(announcement)
                        }}
                        aria-label="Edit announcement"
                        title="Edit announcement"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        type="button"
                        className="builder-danger"
                        onClick={() => remove(announcement)}
                        aria-label="Delete announcement"
                        title="Delete announcement"
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  )}
                </span>
              </div>
              <p>{announcement.body}</p>
            </article>
          ))
        )}
      </div>
    </>
  )
}
