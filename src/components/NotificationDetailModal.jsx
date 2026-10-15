import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, Bell, Check, Clock } from 'lucide-react'
import Modal from './Modal.jsx'

function formatFullDate(dateString) {
  if (!dateString) return ''
  return new Date(dateString).toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function timeAgo(dateString) {
  if (!dateString) return ''
  const diffMs = Date.now() - new Date(dateString).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(diffMs / 3_600_000)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateString).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

export default function NotificationDetailModal({ notification, onClose }) {
  const navigate = useNavigate()
  if (!notification) return null

  const handleOpenLink = () => {
    onClose?.()
    if (notification.link) {
      navigate(notification.link)
    }
  }

  return (
    <Modal
      open={Boolean(notification)}
      onClose={onClose}
      labelledBy="notification-detail-title"
      className="notification-detail-modal"
    >
      <div className="notification-modal-content">
        <div className="notification-modal-header">
          <div className="notification-modal-badge">
            <Bell size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="eyebrow" style={{ margin: 0, fontSize: 10 }}>ACADEMY NOTIFICATION</p>
            <h2 id="notification-detail-title" className="notification-modal-heading">
              {notification.title}
            </h2>
            <div className="notification-modal-meta">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Clock size={11} /> {formatFullDate(notification.createdAt)}
              </span>
              <span>·</span>
              <span>{timeAgo(notification.createdAt)}</span>
              {notification.readAt ? (
                <span className="notif-pill notif-pill-read"><Check size={10} /> Read</span>
              ) : (
                <span className="notif-pill notif-pill-new">New</span>
              )}
            </div>
          </div>
        </div>

        <div className="notification-modal-divider" />

        <div className="notification-modal-body">
          <p style={{ margin: 0 }}>{notification.body}</p>
        </div>

        <div className="notification-modal-footer">
          {notification.link && (
            <button
              type="button"
              className="button button-primary button-compact"
              onClick={handleOpenLink}
            >
              Go to related page <ArrowUpRight size={14} />
            </button>
          )}
          <button
            type="button"
            className="button button-ghost button-compact"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}

