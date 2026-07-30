import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { fetchAuditLogs } from '../../../lib/admin.js'
import Loading from '../../../components/Loading.jsx'

const formatDate = (value) => (value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

export default function AdminAuditPage() {
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const { data: logs = [], isLoading, error } = useQuery({ queryKey: ['admin-audit', action, entityType], queryFn: () => fetchAuditLogs({ action, entityType }) })

  return <>
    <div className="page-title-row"><div><p className="eyebrow">PLATFORM ADMIN</p><h1>Audit Logs</h1><p>Track system-wide actions for compliance and security.</p></div></div>
    <div className="admin-toolbar">
      <input placeholder="Filter by action (e.g. enrollment)…" value={action} onChange={(e) => setAction(e.target.value)} />
      <input placeholder="Filter by entity type (e.g. User)…" value={entityType} onChange={(e) => setEntityType(e.target.value)} />
    </div>
    {error && <p className="form-alert" role="alert">{error.message}</p>}
    <div className="admin-table admin-table-audit">
      <div className="admin-table-head"><span>ACTION</span><span>ENTITY</span><span>ACTOR</span><span>WHEN</span></div>
      {isLoading ? <Loading label="Loading audit trail…" />
        : !logs.length ? <div className="empty-state"><ScrollText size={26} /><strong>No audit entries</strong><p>System actions will appear here as they happen.</p></div>
        : logs.map((log) => <div className="admin-table-row" key={log.id}>
          <span><strong>{log.action}</strong>{log.metadata && Object.keys(log.metadata).length > 0 && <small className="admin-audit-meta">{JSON.stringify(log.metadata)}</small>}</span>
          <span>{log.entityType}<small>{log.entityId}</small></span>
          <span>{log.actor ? <>{log.actor.name}<small>{log.actor.role}</small></> : <em>system</em>}</span>
          <span>{formatDate(log.createdAt)}</span>
        </div>)}
    </div>
  </>
}
