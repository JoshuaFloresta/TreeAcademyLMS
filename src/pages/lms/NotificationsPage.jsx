import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Bell, CheckCheck } from 'lucide-react'
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '../../lib/lms.js'
import Loading from '../../components/Loading.jsx'

function timeAgo(dateString) {
  if (!dateString) return ''
  const diffMs = Date.now() - new Date(dateString).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(diffMs / 3_600_000)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(dateString).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

export default function NotificationsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: notifications = [], isLoading, error } = useQuery({
    queryKey: ['notifications-page'],
    queryFn: fetchNotifications,
  })
  const [filter, setFilter] = useState('all')

  const readAllMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nav-notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications-page'] })
    },
  })

  const readSingleMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nav-notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications-page'] })
    },
  })

  const handleNotificationClick = (notification) => {
    if (!notification.readAt) {
      readSingleMutation.mutate(notification._id)
    }
    const target = notification.link || '/announcements'
    if (target.startsWith('http://') || target.startsWith('https://')) {
      window.location.assign(target)
    } else {
      navigate(target)
    }
  }

  const handleBack = () => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1)
    } else {
      navigate('/dashboard')
    }
  }

  const unreadCount = notifications.filter((notification) => !notification.readAt).length
  const displayedNotifications = filter === 'unread'
    ? notifications.filter((notification) => !notification.readAt)
    : notifications

  return <>
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
        <p className="eyebrow">YOUR ACADEMY UPDATES</p>
        <h1>Notifications</h1>
        <p>Everything important, without the noise. Click any notification to open its page.</p>
      </div>
      <div className="admin-row-actions">
        {unreadCount > 0 && (
          <button
            type="button"
            className="button button-ghost button-compact"
            onClick={() => readAllMutation.mutate()}
            disabled={readAllMutation.isPending}
          >
            <CheckCheck size={14} /> {readAllMutation.isPending ? 'Marking…' : 'Mark all as read'}
          </button>
        )}
      </div>
    </div>

    <div className="notification-tabs">
      <button
        type="button"
        className={`notification-tab-btn ${filter === 'all' ? 'active' : ''}`}
        onClick={() => setFilter('all')}
      >
        All updates ({notifications.length})
      </button>
      <button
        type="button"
        className={`notification-tab-btn ${filter === 'unread' ? 'active' : ''}`}
        onClick={() => setFilter('unread')}
      >
        Unread {unreadCount > 0 && <span className="tab-pill">{unreadCount}</span>}
      </button>
    </div>

    {isLoading && <Loading block label="Loading notifications…" />}
    {error && (
      <div className="empty-state">
        <Bell size={26} />
        <strong>Could not load notifications</strong>
        <p>{error.message}</p>
      </div>
    )}
    {!isLoading && !error && displayedNotifications.length === 0 && (
      <div className="empty-state">
        <Bell size={26} />
        <strong>{filter === 'unread' ? 'No unread notifications' : 'You’re all caught up'}</strong>
        <p>{filter === 'unread' ? 'All your notifications have been marked as read.' : 'New academy updates will show up here.'}</p>
      </div>
    )}

    <div className="notification-list">
      {displayedNotifications.map((notification) => (
        <article
          key={notification._id}
          className={`notification-item clickable ${notification.readAt ? '' : 'unread'}`}
          onClick={() => handleNotificationClick(notification)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              handleNotificationClick(notification)
            }
          }}
          tabIndex={0}
          role="button"
          aria-label={`Open: ${notification.title}`}
        >
          <span className={`notice-icon ${!notification.readAt ? 'gold' : ''}`}>
            <Bell size={18} />
          </span>
          <div className="notification-item-main">
            <div className="notification-item-header">
              <strong>{notification.title}</strong>
              <small>{timeAgo(notification.createdAt)}</small>
            </div>
            <p>{notification.body}</p>
          </div>
          {!notification.readAt && <span className="notification-new">New</span>}
        </article>
      ))}
    </div>
  </>
}
