import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  CheckCheck,
  CheckCircle2,
  Edit3,
  Globe,
  Mail,
  Megaphone,
  Pin,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { useConfirm } from '../../lib/confirmContext.js'
import { useToast } from '../../lib/toastContext.js'
import {
  createStaffAnnouncement,
  deleteAnnouncement,
  fetchAnnouncement,
  fetchAnnouncements,
  fetchCourses,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
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

function AnnouncementDetailView({ announcementId, role, user, onBack, onMarkRead }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const isStaff = role !== 'learner'

  const { data: announcement, isLoading, error } = useQuery({
    queryKey: ['announcement', announcementId],
    queryFn: async () => {
      try {
        return await fetchAnnouncement(announcementId)
      } catch (err) {
        const cached = queryClient.getQueryData(['announcements'])?.find((a) => a.id === announcementId)
        if (cached) return cached
        const all = await fetchAnnouncements()
        const found = all.find((a) => a.id === announcementId)
        if (found) return found
        throw err
      }
    },
    initialData: () => queryClient.getQueryData(['announcements'])?.find((a) => a.id === announcementId),
    retry: 1,
  })

  useEffect(() => {
    if (announcementId) {
      onMarkRead?.(announcementId)
    }
  }, [announcementId, onMarkRead])

  const remove = async () => {
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
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
      onBack()
    } catch (e) {
      toast.error(e.message || 'Failed to delete announcement.')
    }
  }

  const canModify = role === 'admin' || announcement?.authorId === user?.id

  return (
    <div className="announcement-detail-view">
      <button
        type="button"
        className="filter-button"
        onClick={onBack}
        style={{ marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
        aria-label="Back to announcements"
      >
        <ArrowLeft size={15} /> Back to announcements
      </button>

      {announcement && (
        <div className="breadcrumbs" style={{ marginBottom: 14 }}>
          <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={onBack}>
            Announcements
          </span>
          <span>&gt;</span>
          <span>{announcement.courseTitle}</span>
          <span>&gt;</span>
          <strong>{announcement.title}</strong>
        </div>
      )}

      {isLoading && <Loading label="Loading announcement…" />}
      {error && (
        <div className="empty-state">
          <Megaphone size={26} />
          <strong>Could not load announcement</strong>
          <p>{error.message || 'This announcement may have been removed or does not exist.'}</p>
        </div>
      )}
      {!isLoading && !error && announcement && (
        <article className={`announce-card announce-detail-card ${announcement.pinned ? 'pinned' : ''}`}>
          <div className="announce-head">
            <div>
              <small style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {!announcement.courseId && <Globe size={11} />}
                {announcement.courseTitle.toUpperCase()}
              </small>
              <h2 style={{ fontSize: 22, margin: '8px 0 4px', color: 'var(--forest)', fontWeight: 750 }}>
                {announcement.pinned && <Pin size={16} />} {announcement.title}
              </h2>
            </div>
            <span className="announce-meta">
              {announcement.authorName} · {when(announcement.createdAt)}
              {isStaff && canModify && (
                <span style={{ display: 'inline-flex', gap: 4, marginLeft: 8 }}>
                  <button
                    type="button"
                    className="builder-danger"
                    onClick={remove}
                    aria-label="Delete announcement"
                    title="Delete announcement"
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              )}
            </span>
          </div>
          <p className="announce-detail-body">{announcement.body}</p>
        </article>
      )}
    </div>
  )
}

export default function AnnouncementsPage({ role, user, announcementId }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const isStaff = role !== 'learner'

  const [composing, setComposing] = useState(false)
  const [editingAnnouncement, setEditingAnnouncement] = useState(null)
  const [filter, setFilter] = useState('all') // 'all', 'unread', 'pinned'
  const [search, setSearch] = useState('')
  const [courseFilter, setCourseFilter] = useState('all')

  const storageKey = `tree_read_announcements_${user?.id || 'guest'}`
  const [readIds, setReadIds] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw ? new Set(JSON.parse(raw)) : new Set()
    } catch {
      return new Set()
    }
  })

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => fetchAnnouncements(),
  })
  const { data: courses = [] } = useQuery({
    queryKey: ['courses'],
    queryFn: fetchCourses,
  })
  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications-page'],
    queryFn: fetchNotifications,
  })

  const markSingleReadMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nav-notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications-page'] })
    },
  })

  const markAllReadMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nav-notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications-page'] })
    },
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['announcements'] })

  const isAnnouncementRead = (announcement) => {
    if (readIds.has(announcement.id)) return true
    const matchedNotif = notifications.find(
      (n) => n.link === `/announcements/${announcement.id}` || (n.title && n.title.includes(announcement.title))
    )
    if (matchedNotif && matchedNotif.readAt) return true
    return false
  }

  const markAsRead = (id) => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      try {
        localStorage.setItem(storageKey, JSON.stringify(Array.from(next)))
      } catch (err) {
        console.error(err)
      }
      return next
    })
    const matchedNotif = notifications.find(
      (n) =>
        !n.readAt &&
        (n.link === `/announcements/${id}` ||
          (announcements.find((a) => a.id === id)?.title &&
            n.title?.includes(announcements.find((a) => a.id === id)?.title)))
    )
    if (matchedNotif) {
      markSingleReadMutation.mutate(matchedNotif._id)
    }
  }

  const markAllAsRead = async () => {
    const allIds = announcements.map((a) => a.id)
    setReadIds((prev) => {
      const next = new Set(prev)
      allIds.forEach((id) => next.add(id))
      try {
        localStorage.setItem(storageKey, JSON.stringify(Array.from(next)))
      } catch (err) {
        console.error(err)
      }
      return next
    })
    try {
      await markAllReadMutation.mutateAsync()
    } catch {
      // ignore
    }
    toast.success('All announcements marked as read.')
  }

  const unreadCount = useMemo(() => {
    return announcements.filter((a) => !isAnnouncementRead(a)).length
  }, [announcements, readIds, notifications])

  const pinnedCount = useMemo(() => {
    return announcements.filter((a) => a.pinned).length
  }, [announcements])

  const filteredAnnouncements = useMemo(() => {
    return announcements.filter((announcement) => {
      if (filter === 'unread' && isAnnouncementRead(announcement)) return false
      if (filter === 'pinned' && !announcement.pinned) return false

      if (courseFilter !== 'all') {
        if (courseFilter === 'academy-wide' && announcement.courseId) return false
        if (courseFilter !== 'academy-wide' && String(announcement.courseId) !== String(courseFilter)) return false
      }

      if (search.trim()) {
        const query = search.trim().toLowerCase()
        const matchTitle = announcement.title?.toLowerCase().includes(query)
        const matchBody = announcement.body?.toLowerCase().includes(query)
        const matchCourse = announcement.courseTitle?.toLowerCase().includes(query)
        const matchAuthor = announcement.authorName?.toLowerCase().includes(query)
        if (!matchTitle && !matchBody && !matchCourse && !matchAuthor) return false
      }

      return true
    })
  }, [announcements, filter, courseFilter, search, readIds, notifications])

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

  const handleBack = () => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1)
    } else {
      navigate('/dashboard')
    }
  }

  if (announcementId) {
    return (
      <AnnouncementDetailView
        announcementId={announcementId}
        role={role}
        user={user}
        onBack={() => navigate('/announcements')}
        onMarkRead={markAsRead}
      />
    )
  }

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {unreadCount > 0 && (
            <button
              type="button"
              className="button button-ghost button-compact"
              onClick={markAllAsRead}
              disabled={markAllReadMutation.isPending}
            >
              <CheckCheck size={14} /> Mark all as read
            </button>
          )}
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

      {/* Filter Tabs */}
      <div className="announce-tabs">
        <button
          type="button"
          className={`announce-tab-btn ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All announcements ({announcements.length})
        </button>
        <button
          type="button"
          className={`announce-tab-btn ${filter === 'unread' ? 'active' : ''}`}
          onClick={() => setFilter('unread')}
        >
          Unread {unreadCount > 0 && <span className="tab-pill">{unreadCount}</span>}
        </button>
        {pinnedCount > 0 && (
          <button
            type="button"
            className={`announce-tab-btn ${filter === 'pinned' ? 'active' : ''}`}
            onClick={() => setFilter('pinned')}
          >
            <Pin size={12} /> Pinned ({pinnedCount})
          </button>
        )}
      </div>

      {/* Secondary Search & Scope Toolbar */}
      <div className="announce-toolbar">
        <div className="announce-search-box">
          <Search size={15} style={{ color: '#889186' }} />
          <input
            type="text"
            placeholder="Search announcements by title or content…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search announcements"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              style={{
                background: 'none',
                border: 0,
                color: '#889186',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {courses.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--forest)', textTransform: 'uppercase' }}>
              Scope:
            </label>
            <select
              className="announce-filter-select"
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
              aria-label="Filter by program"
            >
              <option value="all">All Programs &amp; Academy</option>
              <option value="academy-wide">Academy-Wide Only</option>
              {courses.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="announce-list">
        {isLoading ? (
          <Loading label="Loading announcements…" />
        ) : !announcements.length ? (
          <p className="operations-note">
            <Megaphone size={17} /> No announcements yet.
          </p>
        ) : filter === 'unread' && unreadCount === 0 ? (
          <div className="empty-state" style={{ marginTop: 8 }}>
            <CheckCircle2 size={32} style={{ color: 'var(--forest)' }} />
            <strong>You’re all caught up</strong>
            <p>There are no unread announcements at this time.</p>
            <button
              type="button"
              className="button button-ghost button-compact"
              onClick={() => {
                setFilter('all')
                setSearch('')
                setCourseFilter('all')
              }}
              style={{ marginTop: 8 }}
            >
              View all announcements
            </button>
          </div>
        ) : !filteredAnnouncements.length ? (
          <div className="empty-state" style={{ marginTop: 8 }}>
            <Megaphone size={30} />
            <strong>No announcements found</strong>
            <p>No announcements match your current filter or search criteria.</p>
            <button
              type="button"
              className="button button-ghost button-compact"
              onClick={() => {
                setFilter('all')
                setSearch('')
                setCourseFilter('all')
              }}
              style={{ marginTop: 8 }}
            >
              Reset filters
            </button>
          </div>
        ) : (
          filteredAnnouncements.map((announcement) => {
            const isRead = isAnnouncementRead(announcement)
            return (
              <article
                className={`announce-card clickable ${!isRead ? 'unread' : ''} ${announcement.pinned ? 'pinned' : ''}`}
                key={announcement.id}
                onClick={() => {
                  markAsRead(announcement.id)
                  navigate(`/announcements/${announcement.id}`)
                }}
                tabIndex={0}
                role="button"
                aria-label={`View announcement: ${announcement.title}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    markAsRead(announcement.id)
                    navigate(`/announcements/${announcement.id}`)
                  }
                }}
              >
                <div className="announce-head">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <small style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {!announcement.courseId && <Globe size={11} />}
                        {announcement.courseTitle.toUpperCase()}
                      </small>
                      {!isRead && <span className="announce-unread-badge">New</span>}
                    </div>
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
                          onClick={(e) => {
                            e.stopPropagation()
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
                          onClick={(e) => {
                            e.stopPropagation()
                            remove(announcement)
                          }}
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
            )
          })
        )}
      </div>
    </>
  )
}
