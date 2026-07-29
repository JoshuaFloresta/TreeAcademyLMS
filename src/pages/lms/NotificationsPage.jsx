import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '../../lib/lms.js'

function timeAgo(dateString) {
  const diffMs = Date.now() - new Date(dateString).getTime()
  const hours = Math.floor(diffMs / 3_600_000)
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export default function NotificationsPage() {
  const queryClient = useQueryClient()
  const { data: notifications = [], isLoading, error } = useQuery({ queryKey: ['nav-notifications'], queryFn: fetchNotifications })
  const readMutation = useMutation({ mutationFn: markNotificationRead, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nav-notifications'] }) })
  const readAllMutation = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nav-notifications'] }) })
  const hasUnread = notifications.some((notification) => !notification.readAt)

  return <>
    <div className="page-title-row"><div><p className="eyebrow">YOUR ACADEMY UPDATES</p><h1>Notifications</h1><p>Everything important, without the noise.</p></div><button className="filter-button" onClick={() => readAllMutation.mutate()} disabled={!hasUnread || readAllMutation.isPending}>{readAllMutation.isPending ? 'Marking…' : 'Mark all as read'}</button></div>
    {isLoading && <div className="empty-state"><Bell size={26} /><strong>Loading notifications…</strong></div>}
    {error && <div className="empty-state"><Bell size={26} /><strong>Could not load notifications</strong><p>{error.message}</p></div>}
    {!isLoading && !error && notifications.length === 0 && <div className="empty-state"><Bell size={26} /><strong>You’re all caught up</strong><p>New academy updates will show up here.</p></div>}
    <div className="notification-list">
      {notifications.map((notification) => <article key={notification._id} className="notification-item" onClick={() => !notification.readAt && readMutation.mutate(notification._id)} style={{ cursor: notification.readAt ? 'default' : 'pointer' }}>
        <span className={`notice-icon ${!notification.readAt ? 'gold' : ''}`}><Bell size={18} /></span>
        <div><strong>{notification.title}</strong><p>{notification.body}</p><small>{timeAgo(notification.createdAt)}</small></div>
        {!notification.readAt && <i className="unread-dot" />}
      </article>)}
    </div>
  </>
}
