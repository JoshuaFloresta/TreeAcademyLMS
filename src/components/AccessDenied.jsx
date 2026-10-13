import { Link } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'

export default function AccessDenied({ role, requiredRoles = [] }) {
  const targetHome = role === 'admin' ? '/admin/dashboard' : '/dashboard'
  const roleName = role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Your account'
  const requirementText = requiredRoles.length > 0
    ? `This page requires ${requiredRoles.join(' or ')} permissions.`
    : 'You do not have the required permissions to view this page.'

  return (
    <div className="empty-state" role="alert" style={{ maxWidth: 540, margin: '60px auto', padding: '40px 24px' }}>
      <ShieldAlert size={42} style={{ color: '#c0392b', marginBottom: 12 }} />
      <strong style={{ fontSize: 18, color: 'var(--forest)' }}>Access Denied (403 Forbidden)</strong>
      <p style={{ fontSize: 13, color: '#666', lineHeight: 1.6, margin: '10px 0 20px' }}>
        {roleName} does not have access to this section. {requirementText}
      </p>
      <div>
        <Link to={targetHome} className="button button-primary button-compact">
          Return to Dashboard
        </Link>
      </div>
    </div>
  )
}

