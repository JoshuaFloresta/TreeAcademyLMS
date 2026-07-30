import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Flag } from 'lucide-react'
import StatusPill from '../../../components/StatusPill.jsx'
import { useToast } from '../../../lib/toastContext.js'
import { fetchReports, updateReport } from '../../../lib/admin.js'
import Loading from '../../../components/Loading.jsx'

const statuses = ['submitted', 'reviewing', 'actioned', 'dismissed']
const statusKind = { submitted: 'gold', reviewing: 'gold', actioned: 'green', dismissed: 'red' }
const formatDate = (value) => (value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

export default function AdminReportsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [statusFilter, setStatusFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [error, setError] = useState('')
  const { data: reports = [], isLoading } = useQuery({ queryKey: ['admin-reports', statusFilter, roleFilter], queryFn: () => fetchReports({ status: statusFilter, role: roleFilter }) })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-reports'] })
  const updateMutation = useMutation({ mutationFn: ({ id, updates }) => updateReport(id, updates) })

  const update = async (id, updates, message) => { setError(''); try { await updateMutation.mutateAsync({ id, updates }); toast.success(message ?? 'Updated.'); invalidate() } catch (e) { setError(e.message); toast.error(e.message) } }
  const note = async (report) => { const reviewNote = window.prompt('Add a review note:', report.reviewNote ?? ''); if (reviewNote === null) return; update(report.id, { reviewNote }, 'Note saved.') }

  return <>
    <div className="page-title-row"><div><p className="eyebrow">PLATFORM ADMIN</p><h1>Reports</h1><p>Review reports submitted by students and instructors.</p></div></div>
    <div className="admin-toolbar">
      <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}><option value="">All roles</option><option value="learner">Learner</option><option value="instructor">Instructor</option></select>
      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{value}</option>)}</select>
    </div>
    {error && <p className="form-alert" role="alert">{error}</p>}
    {isLoading ? <Loading label="Loading reports…" />
      : !reports.length ? <div className="empty-state"><Flag size={26} /><strong>No reports</strong><p>Reports submitted by students and instructors will appear here.</p></div>
      : <div className="admin-ticket-list">
        {reports.map((report) => <article className="admin-ticket" key={report.id}>
          <div className="admin-ticket-head">
            <div><h3>{report.title}</h3><small>{report.reporter?.name} · {report.reporterRole} · {formatDate(report.createdAt)}</small></div>
            <div className="admin-ticket-pills"><span className="admin-chip">{report.type}</span><StatusPill kind={statusKind[report.status]}>{report.status}</StatusPill></div>
          </div>
          <p className="admin-ticket-body">{report.details}</p>
          {report.reviewNote && <p className="admin-ticket-response"><strong>Note:</strong> {report.reviewNote}</p>}
          <div className="admin-row-actions">
            <select value={report.status} onChange={(e) => update(report.id, { status: e.target.value })}>{statuses.map((value) => <option key={value} value={value}>{value}</option>)}</select>
            <button className="button button-ghost button-compact" onClick={() => note(report)}>Add note</button>
          </div>
        </article>)}
      </div>}
  </>
}
