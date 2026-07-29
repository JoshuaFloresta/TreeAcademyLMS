import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LifeBuoy } from 'lucide-react'
import StatusPill from '../../../components/StatusPill.jsx'
import { useToast } from '../../../lib/toastContext.js'
import { fetchSupportTickets, updateSupportTicket } from '../../../lib/admin.js'

const statuses = ['open', 'in_progress', 'resolved', 'closed']
const statusKind = { open: 'gold', in_progress: 'gold', resolved: 'green', closed: 'red' }
const priorityKind = { high: 'red', normal: 'green', low: 'green' }
const formatDate = (value) => (value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

export default function AdminSupportPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [statusFilter, setStatusFilter] = useState('')
  const [error, setError] = useState('')
  const { data: tickets = [], isLoading } = useQuery({ queryKey: ['admin-support', statusFilter], queryFn: () => fetchSupportTickets({ status: statusFilter }) })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-support'] })
  const updateMutation = useMutation({ mutationFn: ({ id, updates }) => updateSupportTicket(id, updates) })

  const update = async (id, updates, message) => { setError(''); try { await updateMutation.mutateAsync({ id, updates }); toast.success(message ?? 'Updated.'); invalidate() } catch (e) { setError(e.message); toast.error(e.message) } }
  const respond = async (ticket) => { const response = window.prompt('Response to the requester:', ticket.response ?? ''); if (response === null) return; update(ticket.id, { response, status: 'resolved' }, 'Response sent.') }

  return <>
    <div className="page-title-row"><div><p className="eyebrow">PLATFORM ADMIN</p><h1>Support / Helpdesk</h1><p>Manage support tickets raised by learners and instructors.</p></div></div>
    <div className="admin-toolbar">
      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</select>
    </div>
    {error && <p className="form-alert" role="alert">{error}</p>}
    {isLoading ? <p className="operations-note">Loading tickets…</p>
      : !tickets.length ? <div className="empty-state"><LifeBuoy size={26} /><strong>No support tickets</strong><p>Tickets submitted by users will land here.</p></div>
      : <div className="admin-ticket-list">
        {tickets.map((ticket) => <article className="admin-ticket" key={ticket.id}>
          <div className="admin-ticket-head">
            <div><h3>{ticket.subject}</h3><small>{ticket.requester?.name} · {ticket.requester?.role} · {formatDate(ticket.createdAt)}</small></div>
            <div className="admin-ticket-pills"><StatusPill kind={priorityKind[ticket.priority]}>{ticket.priority}</StatusPill><StatusPill kind={statusKind[ticket.status]}>{ticket.status.replace('_', ' ')}</StatusPill></div>
          </div>
          <p className="admin-ticket-body"><span className="admin-chip">{ticket.category}</span> {ticket.message}</p>
          {ticket.response && <p className="admin-ticket-response"><strong>Response:</strong> {ticket.response}</p>}
          <div className="admin-row-actions">
            <select value={ticket.status} onChange={(e) => update(ticket.id, { status: e.target.value })}>{statuses.map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</select>
            <select value={ticket.priority} onChange={(e) => update(ticket.id, { priority: e.target.value })}>{['low', 'normal', 'high'].map((value) => <option key={value} value={value}>{value}</option>)}</select>
            <button className="button button-ghost button-compact" onClick={() => respond(ticket)}>Respond</button>
          </div>
        </article>)}
      </div>}
  </>
}
