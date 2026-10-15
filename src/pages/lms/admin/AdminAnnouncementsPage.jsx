import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  BookOpen,
  Calendar,
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
  User,
  X,
} from 'lucide-react'
import { useConfirm } from '../../../lib/confirmContext.js'
import { useToast } from '../../../lib/toastContext.js'
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
} from '../../../lib/lms.js'
import Loading from '../../../components/Loading.jsx'

const formatDate = (value) => {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function AnnouncementModal({ announcement, courses, onDone, onClose }) {
  const isEditing = Boolean(announcement)
  const [courseId, setCourseId] = useState(announcement?.courseId ?? '')
  const [title, setTitle] = useState(announcement?.title ?? '')
  const [body, setBody] = useState(announcement?.body ?? '')
  const [pinned, setPinned] = useState(announcement?.pinned ?? false)
  const [sendEmail, setSendEmail] = useState(true)
  const [error, setError] = useState('')

  const toast = useToast()
  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        courseId: courseId || null,
        title: title.trim(),
        body: body.trim(),
        pinned,
        sendEmail,
      }
      return isEditing
        ? updateAnnouncement(announcement.id, payload)
        : createStaffAnnouncement(payload)
    },
  })

  const selectedCourse = courses.find((c) => String(c._id) === String(courseId))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (title.trim().length < 2) {
      setError('Title must be at least 2 characters long.')
      return
    }
    if (body.trim().length < 2) {
      setError('Message body must be at least 2 characters long.')
      return
    }
    setError('')
    try {
      await mutation.mutateAsync()
      toast.success(isEditing ? 'Announcement updated successfully.' : 'Announcement posted successfully.')
      onDone()
    } catch (err) {
      setError(err.message || 'Failed to save announcement.')
    }
  }

  return (
    <div className="admin-announce-modal-backdrop" onClick={onClose}>
      <div className="admin-announce-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <p className="eyebrow" style={{ color: 'var(--gold)' }}>
              {isEditing ? 'EDIT ANNOUNCEMENT' : 'NEW ANNOUNCEMENT'}
            </p>
            <h2 style={{ margin: '4px 0 0', color: 'var(--forest)', fontSize: 22 }}>
              {isEditing ? 'Update Announcement' : 'Create New Announcement'}
            </h2>
          </div>
          <button
            type="button"
            className="admin-announce-action-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
          <div className="form-field">
            <label style={{ color: 'var(--forest)', fontWeight: 700, fontSize: 12 }}>
              Target Audience / Scope
            </label>
            <select
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              style={{
                width: '100%',
                minHeight: 42,
                padding: '8px 12px',
                color: 'var(--forest)',
                background: '#fff',
                border: '1px solid #cdd7cc',
                borderRadius: 6,
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              <option value="">All Programs (Academy-Wide Broadcast)</option>
              {courses.map((course) => (
                <option key={course._id} value={course._id}>
                  Course: {course.title}
                </option>
              ))}
            </select>
            <small style={{ color: '#687569', fontSize: 11 }}>
              {courseId
                ? `Only learners enrolled in "${selectedCourse?.title || 'Selected Course'}" will see this.`
                : 'All learners and staff across the academy will see this announcement.'}
            </small>
          </div>

          <div className="form-field">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label style={{ color: 'var(--forest)', fontWeight: 700, fontSize: 12 }}>Title</label>
              <small style={{ color: '#889186', fontSize: 11 }}>{title.length}/160</small>
            </div>
            <input
              type="text"
              maxLength={160}
              placeholder="e.g. Schedule Update: Real Estate Broker Review Cohort 4"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              style={{
                width: '100%',
                minHeight: 42,
                padding: '8px 12px',
                color: 'var(--forest)',
                background: '#fff',
                border: '1px solid #cdd7cc',
                borderRadius: 6,
                fontSize: 14,
              }}
            />
          </div>

          <div className="form-field">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label style={{ color: 'var(--forest)', fontWeight: 700, fontSize: 12 }}>Message Body</label>
              <small style={{ color: '#889186', fontSize: 11 }}>{body.length}/4000</small>
            </div>
            <textarea
              rows={6}
              maxLength={4000}
              placeholder="Write your announcement details here. Important notes, instructions, or meeting links..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                color: 'var(--forest)',
                background: '#fff',
                border: '1px solid #cdd7cc',
                borderRadius: 6,
                fontSize: 13,
                lineHeight: 1.6,
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ display: 'grid', gap: 12, padding: '14px 16px', background: '#f8faf7', border: '1px solid #e1e7de', borderRadius: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--forest)', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--forest)' }}
              />
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Pin size={15} style={{ color: 'var(--gold)' }} /> Pin to the top of announcements
              </span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--forest)', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--forest)' }}
              />
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Mail size={15} style={{ color: 'var(--forest)' }} />
                {isEditing ? 'Resend email notification with these updates' : 'Send email notification to recipients'}
              </span>
            </label>

            {sendEmail && (
              <div className="admin-announce-email-hint">
                <CheckCircle2 size={16} />
                <span>
                  {courseId
                    ? `An official email notification will be dispatched to all learners actively enrolled in "${selectedCourse?.title || 'the selected course'}".`
                    : 'An academy-wide broadcast email will be dispatched to all active learners in the system.'}
                </span>
              </div>
            )}
          </div>

          {error && <span className="builder-error">{error}</span>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 10 }}>
            <button type="button" className="button button-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? 'Saving...' : isEditing ? 'Update Announcement' : 'Publish Announcement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AdminAnnouncementDetailView({ announcementId, onBack, onEdit, onMarkRead }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()

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

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete this announcement?',
      message: `Are you sure you want to permanently delete "${announcement?.title}"? This action cannot be undone.`,
      confirmLabel: 'Delete Announcement',
      danger: true,
    })
    if (!confirmed) return

    try {
      await deleteAnnouncement(announcement.id)
      toast.success('Announcement deleted.')
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
      onBack()
    } catch (err) {
      toast.error(err.message || 'Failed to delete announcement.')
    }
  }

  const handleTogglePin = async () => {
    try {
      await updateAnnouncement(announcement.id, { pinned: !announcement.pinned })
      toast.success(announcement.pinned ? 'Announcement unpinned.' : 'Announcement pinned to top.')
      queryClient.invalidateQueries({ queryKey: ['announcement', announcementId] })
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
    } catch (err) {
      toast.error(err.message || 'Failed to update pin state.')
    }
  }

  return (
    <div className="admin-announcement-detail-view">
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

      {isLoading && <Loading label="Loading announcement..." />}
      {error && (
        <div className="empty-state">
          <Megaphone size={26} />
          <strong>Could not load announcement</strong>
          <p>{error.message || 'This announcement may have been removed or does not exist.'}</p>
        </div>
      )}

      {!isLoading && !error && announcement && (
        <article className={`admin-announce-item ${announcement.pinned ? 'pinned' : ''}`} style={{ padding: 28 }}>
          <div className="admin-announce-item-head">
            <div>
              <div className="admin-announce-item-badges">
                {!announcement.courseId ? (
                  <span className="scope-badge academy">
                    <Globe size={11} /> Academy-Wide Broadcast
                  </span>
                ) : (
                  <span className="scope-badge course">
                    <BookOpen size={11} /> {announcement.courseTitle}
                  </span>
                )}
                {announcement.pinned && (
                  <span className="scope-badge pinned">
                    <Pin size={11} /> Pinned
                  </span>
                )}
              </div>
              <h2 style={{ margin: '8px 0 0', color: 'var(--forest)', fontSize: 22, fontWeight: 750 }}>
                {announcement.title}
              </h2>
            </div>

            <div className="admin-announce-actions">
              <button
                type="button"
                className="admin-announce-action-btn"
                title={announcement.pinned ? 'Unpin announcement' : 'Pin to top'}
                onClick={handleTogglePin}
              >
                <Pin size={15} style={{ color: announcement.pinned ? 'var(--gold)' : undefined }} />
              </button>
              <button
                type="button"
                className="admin-announce-action-btn"
                title="Edit announcement"
                onClick={() => onEdit(announcement)}
              >
                <Edit3 size={15} />
              </button>
              <button
                type="button"
                className="admin-announce-action-btn danger"
                title="Delete announcement"
                onClick={handleDelete}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>

          <p style={{ margin: '18px 0', color: '#414d42', fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {announcement.body}
          </p>

          <div className="admin-announce-meta" style={{ borderTop: '1px solid #edf0ec', paddingTop: 14, marginTop: 14 }}>
            <span>
              <User size={13} /> Posted by <strong>{announcement.authorName}</strong> ({announcement.authorRole})
            </span>
            <span>
              <Calendar size={13} /> {formatDate(announcement.createdAt)}
            </span>
          </div>
        </article>
      )}
    </div>
  )
}

export default function AdminAnnouncementsPage({ announcementId }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()

  const [modalOpen, setModalOpen] = useState(false)
  const [editingAnnouncement, setEditingAnnouncement] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedScope, setSelectedScope] = useState('all') // 'all', 'academy-wide', or courseId
  const [pinnedFilter, setPinnedFilter] = useState('all') // 'all', 'pinned'
  const [statusTab, setStatusTab] = useState('all') // 'all', 'unread', 'pinned'

  const storageKey = `tree_admin_read_announcements`
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

  const handleDelete = async (announcement) => {
    const confirmed = await confirm({
      title: 'Delete this announcement?',
      message: `Are you sure you want to permanently delete "${announcement.title}"? This action cannot be undone.`,
      confirmLabel: 'Delete Announcement',
      danger: true,
    })
    if (!confirmed) return

    try {
      await deleteAnnouncement(announcement.id)
      toast.success('Announcement deleted.')
      refresh()
    } catch (err) {
      toast.error(err.message || 'Failed to delete announcement.')
    }
  }

  const handleTogglePin = async (announcement) => {
    try {
      await updateAnnouncement(announcement.id, { pinned: !announcement.pinned })
      toast.success(announcement.pinned ? 'Announcement unpinned.' : 'Announcement pinned to top.')
      refresh()
    } catch (err) {
      toast.error(err.message || 'Failed to update pin state.')
    }
  }

  // Filtered list
  const filteredAnnouncements = useMemo(() => {
    return announcements.filter((item) => {
      // Status tab filter
      if (statusTab === 'unread' && isAnnouncementRead(item)) return false
      if (statusTab === 'pinned' && !item.pinned) return false

      // Scope filter
      if (selectedScope === 'academy-wide' && item.courseId) return false
      if (selectedScope !== 'all' && selectedScope !== 'academy-wide' && String(item.courseId) !== String(selectedScope)) {
        return false
      }

      // Pinned filter dropdown (if not using tab)
      if (pinnedFilter === 'pinned' && !item.pinned) return false

      // Search term
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase()
        const matchTitle = item.title?.toLowerCase().includes(term)
        const matchBody = item.body?.toLowerCase().includes(term)
        const matchAuthor = item.authorName?.toLowerCase().includes(term)
        const matchCourse = item.courseTitle?.toLowerCase().includes(term)
        if (!matchTitle && !matchBody && !matchAuthor && !matchCourse) return false
      }

      return true
    })
  }, [announcements, statusTab, selectedScope, pinnedFilter, searchTerm, readIds, notifications])

  // Statistics
  const totalCount = announcements.length
  const unreadCount = useMemo(
    () => announcements.filter((a) => !isAnnouncementRead(a)).length,
    [announcements, readIds, notifications]
  )
  const academyCount = announcements.filter((a) => !a.courseId).length
  const courseCount = announcements.filter((a) => Boolean(a.courseId)).length
  const pinnedCount = announcements.filter((a) => a.pinned).length

  if (announcementId) {
    return (
      <>
        <AdminAnnouncementDetailView
          announcementId={announcementId}
          onBack={() => navigate('/admin/announcements')}
          onMarkRead={markAsRead}
          onEdit={(announcement) => {
            setEditingAnnouncement(announcement)
            setModalOpen(true)
          }}
        />
        {modalOpen && (
          <AnnouncementModal
            announcement={editingAnnouncement}
            courses={courses}
            onDone={() => {
              queryClient.invalidateQueries({ queryKey: ['announcements'] })
              queryClient.invalidateQueries({ queryKey: ['announcement', announcementId] })
              setModalOpen(false)
              setEditingAnnouncement(null)
            }}
            onClose={() => {
              setModalOpen(false)
              setEditingAnnouncement(null)
            }}
          />
        )}
      </>
    )
  }

  const handleBack = () => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1)
    } else {
      navigate('/admin/dashboard')
    }
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
          <p className="eyebrow">COMMUNICATIONS &amp; BROADCASTS</p>
          <h1>Announcements</h1>
          <p>
            Create, moderate, and broadcast updates to your academy. Announcements notify learners in-app and via email.
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
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              setEditingAnnouncement(null)
              setModalOpen(true)
            }}
          >
            <Plus size={16} /> New announcement
          </button>
        </div>
      </div>

      {/* Quick metrics summary */}
      <div className="admin-announce-stats">
        <div className="stat-card">
          <div className="stat-icon"><Megaphone size={19} /></div>
          <div>
            <p>Total Announcements</p>
            <h2>{totalCount}</h2>
            <small>Active in feed</small>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon gold"><Globe size={19} /></div>
          <div>
            <p>Academy-Wide</p>
            <h2>{academyCount}</h2>
            <small>Broadcast to all learners</small>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><BookOpen size={19} /></div>
          <div>
            <p>Course-Specific</p>
            <h2>{courseCount}</h2>
            <small>Targeted cohort updates</small>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon gold"><Pin size={19} /></div>
          <div>
            <p>Pinned to Top</p>
            <h2>{pinnedCount}</h2>
            <small>Priority announcements</small>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="announce-tabs">
        <button
          type="button"
          className={`announce-tab-btn ${statusTab === 'all' ? 'active' : ''}`}
          onClick={() => setStatusTab('all')}
        >
          All announcements ({totalCount})
        </button>
        <button
          type="button"
          className={`announce-tab-btn ${statusTab === 'unread' ? 'active' : ''}`}
          onClick={() => setStatusTab('unread')}
        >
          Unread {unreadCount > 0 && <span className="tab-pill">{unreadCount}</span>}
        </button>
        {pinnedCount > 0 && (
          <button
            type="button"
            className={`announce-tab-btn ${statusTab === 'pinned' ? 'active' : ''}`}
            onClick={() => setStatusTab('pinned')}
          >
            <Pin size={12} /> Pinned ({pinnedCount})
          </button>
        )}
      </div>

      {/* Search & Filter Toolbar */}
      <div className="admin-announce-toolbar">
        <div className="admin-announce-search">
          <Search size={16} style={{ color: '#8c968b' }} />
          <input
            type="search"
            placeholder="Search announcements by title, content, or author..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="admin-announce-filters">
          <select
            value={selectedScope}
            onChange={(e) => setSelectedScope(e.target.value)}
            aria-label="Filter by scope"
          >
            <option value="all">All Audiences</option>
            <option value="academy-wide">Academy-Wide Only</option>
            {courses.map((course) => (
              <option key={course._id} value={course._id}>
                {course.title}
              </option>
            ))}
          </select>

          <select
            value={pinnedFilter}
            onChange={(e) => setPinnedFilter(e.target.value)}
            aria-label="Filter by pin status"
          >
            <option value="all">All Items</option>
            <option value="pinned">Pinned Only</option>
          </select>
        </div>
      </div>

      {/* Announcement List */}
      <div className="admin-announce-grid">
        {isLoading ? (
          <Loading label="Loading announcements..." />
        ) : statusTab === 'unread' && unreadCount === 0 ? (
          <div className="empty-state" style={{ padding: '32px 20px', textAlign: 'center' }}>
            <CheckCircle2 size={32} style={{ color: 'var(--forest)', margin: '0 auto 8px', display: 'block' }} />
            <strong>You’re all caught up</strong>
            <p style={{ margin: '4px 0 0', color: '#7a8579', fontSize: 13 }}>
              There are no unread announcements at this time.
            </p>
            <button
              type="button"
              className="button button-ghost button-compact"
              onClick={() => {
                setStatusTab('all')
                setSearchTerm('')
                setSelectedScope('all')
              }}
              style={{ marginTop: 10 }}
            >
              View all announcements
            </button>
          </div>
        ) : filteredAnnouncements.length === 0 ? (
          <div className="operations-note" style={{ padding: '32px 20px', textAlign: 'center' }}>
            <Megaphone size={24} style={{ margin: '0 auto 8px', display: 'block', color: 'var(--gold)' }} />
            <strong>No announcements found</strong>
            <p style={{ margin: '4px 0 0', color: '#7a8579', fontSize: 13 }}>
              {searchTerm || selectedScope !== 'all' || pinnedFilter !== 'all'
                ? 'Try adjusting your search filters above.'
                : 'Click "New announcement" above to broadcast an update.'}
            </p>
          </div>
        ) : (
          filteredAnnouncements.map((announcement) => {
            const isAcademyWide = !announcement.courseId
            const isRead = isAnnouncementRead(announcement)
            return (
              <article
                key={announcement.id}
                className={`admin-announce-item ${!isRead ? 'unread' : ''} ${announcement.pinned ? 'pinned' : ''}`}
              >
                <div className="admin-announce-item-head">
                  <div>
                    <div className="admin-announce-item-badges">
                      {isAcademyWide ? (
                        <span className="scope-badge academy">
                          <Globe size={11} /> Academy-Wide Broadcast
                        </span>
                      ) : (
                        <span className="scope-badge course">
                          <BookOpen size={11} /> {announcement.courseTitle}
                        </span>
                      )}
                      {announcement.pinned && (
                        <span className="scope-badge pinned">
                          <Pin size={11} /> Pinned
                        </span>
                      )}
                      {!isRead && (
                        <span className="announce-unread-badge">New</span>
                      )}
                    </div>
                    <h3
                      style={{ margin: '8px 0 0', color: 'var(--forest)', fontSize: 17, fontWeight: 700, cursor: 'pointer' }}
                      onClick={() => {
                        markAsRead(announcement.id)
                        navigate(`/admin/announcements/${announcement.id}`)
                      }}
                    >
                      {announcement.title}
                    </h3>
                  </div>

                  <div className="admin-announce-actions">
                    <button
                      type="button"
                      className="admin-announce-action-btn"
                      title={announcement.pinned ? 'Unpin announcement' : 'Pin to top'}
                      onClick={() => handleTogglePin(announcement)}
                    >
                      <Pin size={15} style={{ color: announcement.pinned ? 'var(--gold)' : undefined }} />
                    </button>
                    <button
                      type="button"
                      className="admin-announce-action-btn"
                      title="Edit announcement"
                      onClick={() => {
                        setEditingAnnouncement(announcement)
                        setModalOpen(true)
                      }}
                    >
                      <Edit3 size={15} />
                    </button>
                    <button
                      type="button"
                      className="admin-announce-action-btn danger"
                      title="Delete announcement"
                      onClick={() => handleDelete(announcement)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <p style={{ margin: '14px 0 16px', color: '#414d42', fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                  {announcement.body}
                </p>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', paddingTop: 12, borderTop: '1px solid #edf0ec', color: '#838e82', fontSize: 11 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <User size={13} /> {announcement.authorName} ({announcement.authorRole || 'Staff'})
                  </span>
                  <span>•</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Calendar size={13} /> Posted {formatDate(announcement.createdAt)}
                  </span>
                  {announcement.updatedAt && announcement.updatedAt !== announcement.createdAt && (
                    <>
                      <span>•</span>
                      <span>Edited {formatDate(announcement.updatedAt)}</span>
                    </>
                  )}
                </div>
              </article>
            )
          })
        )}
      </div>

      {modalOpen && (
        <AnnouncementModal
          announcement={editingAnnouncement}
          courses={courses}
          onDone={() => {
            setModalOpen(false)
            setEditingAnnouncement(null)
            refresh()
          }}
          onClose={() => {
            setModalOpen(false)
            setEditingAnnouncement(null)
          }}
        />
      )}
    </>
  )
}
