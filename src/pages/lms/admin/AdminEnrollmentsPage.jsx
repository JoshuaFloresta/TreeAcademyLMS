import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Check, Clock3, CreditCard, X } from 'lucide-react'
import StatusPill from '../../../components/StatusPill.jsx'
import { useConfirm } from '../../../lib/confirmContext.js'
import { useToast } from '../../../lib/toastContext.js'
import { archiveEnrollment, bulkDecideEnrollments, decideEnrollment, fetchAdminEnrollments } from '../../../lib/admin.js'

const pathwayLabel = { broker: 'Broker Review', consultant: 'Consultant Review', agent: 'Agent Review' }
const statusLabel = {
  application_pending: 'Application started', documents_pending: 'Awaiting signature', documents_complete: 'Agreement signed',
  payment_pending: 'Awaiting payment', contract_pending: 'Awaiting signature', contract_signed: 'Agreement signed',
  paid_approval_pending: 'Paid · awaiting approval', approved: 'Approved', rejected: 'Rejected', refunded: 'Refunded',
}
const pillKind = (status) => (status === 'approved' ? 'green' : status === 'rejected' || status === 'refunded' ? 'red' : status === 'paid_approval_pending' ? 'gold' : 'green')
const rowId = (row) => row._id ?? row.id
const peso = (value) => `₱${Number(value ?? 0).toLocaleString('en-PH')}`
const formatDate = (value) => (value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

export default function AdminEnrollmentsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [showArchived, setShowArchived] = useState(false)
  const { data: enrollments = [], isLoading, isFetching, refetch } = useQuery({ queryKey: ['admin-enrollments', showArchived], queryFn: () => fetchAdminEnrollments({ archived: showArchived ? 'only' : undefined }) })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-enrollments'] })

  const decideMutation = useMutation({ mutationFn: ({ id, decision, reason }) => decideEnrollment(id, decision, reason) })
  const bulkMutation = useMutation({ mutationFn: ({ ids, decision, reason }) => bulkDecideEnrollments(ids, decision, reason) })
  const archiveMutation = useMutation({ mutationFn: ({ id, archived }) => archiveEnrollment(id, archived) })

  const archive = async (row, archived) => {
    if (archived && !(await confirm({ message: `${row.applicant?.name}'s enrollment will be archived and hidden from the active list.`, confirmLabel: 'Archive', danger: false }))) return
    setNotice(''); setError('')
    try { await archiveMutation.mutateAsync({ id: rowId(row), archived }); const message = `Enrollment for ${row.applicant?.name} was ${archived ? 'archived' : 'restored'}.`; setNotice(message); toast.success(message) }
    catch (e) { setError(e.message); toast.error(e.message) }
  }

  const pending = showArchived ? [] : enrollments.filter((row) => row.status === 'paid_approval_pending')
  const awaiting = pending.length
  const confirmedTotal = enrollments.filter((row) => row.status === 'approved').reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
  const selectablePendingIds = pending.map(rowId)
  const allSelected = selectablePendingIds.length > 0 && selectablePendingIds.every((id) => selected.has(id))

  const toggle = (id) => setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  const toggleAll = () => setSelected(() => (allSelected ? new Set() : new Set(selectablePendingIds)))

  const decide = async (row, decision) => {
    if (decision === 'approved' && !(await confirm({ title: 'Approve this enrollment?', message: `${row.applicant?.name}'s learner account will be created and sign-in credentials emailed immediately.`, confirmLabel: 'Approve', danger: false }))) return
    if (decision !== 'approved' && !(await confirm({ title: `${decision === 'rejected' ? 'Reject' : 'Refund'} this enrollment?`, message: `${row.applicant?.name}'s enrollment will be ${decision}. This cannot be undone.`, confirmLabel: decision === 'rejected' ? 'Reject' : 'Refund' }))) return
    const reason = decision === 'approved' ? undefined : (window.prompt(`Reason for ${decision === 'rejected' ? 'rejecting' : 'refunding'} this enrollment (optional):`) ?? '')
    setNotice(''); setError('')
    try {
      const result = await decideMutation.mutateAsync({ id: rowId(row), decision, reason })
      const message = decision === 'approved'
        ? (result.invitation?.delivery === 'sent' ? `${row.applicant?.name} approved — credentials emailed.` : `${row.applicant?.name} approved. Check API logs for the temporary password if email is not configured.`)
        : `Enrollment for ${row.applicant?.name} was ${decision}.`
      setNotice(message); toast.success(message)
      invalidate()
    } catch (e) { setError(e.message); toast.error(e.message) }
  }

  const bulkDecide = async (decision) => {
    const ids = [...selected].filter((id) => selectablePendingIds.includes(id))
    if (!ids.length) return
    const reason = decision === 'approved' ? undefined : (window.prompt(`Reason for ${decision} (optional):`) ?? '')
    if (!(await confirm({ title: `${decision === 'approved' ? 'Approve' : decision === 'rejected' ? 'Reject' : 'Refund'} these enrollments?`, message: decision === 'approved' ? `${ids.length} learner account${ids.length === 1 ? '' : 's'} will be created and credentials emailed immediately.` : `${ids.length} enrollment${ids.length === 1 ? '' : 's'} will be ${decision}.`, confirmLabel: decision === 'approved' ? 'Approve' : decision === 'rejected' ? 'Reject' : 'Refund', danger: decision !== 'approved' }))) return
    setNotice(''); setError('')
    try { const result = await bulkMutation.mutateAsync({ ids, decision, reason }); const message = `${result.processed} enrollment${result.processed === 1 ? '' : 's'} ${decision}.`; setNotice(message); toast.success(message); setSelected(new Set()); invalidate() }
    catch (e) { setError(e.message); toast.error(e.message) }
  }

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">PLATFORM ADMIN</p><h1>Enrollment Management</h1><p>{showArchived ? 'Archived enrollments — restore any that were tidied away by mistake.' : 'Approve, reject, or refund paid enrollments — individually or in bulk.'}</p></div>
      <div className="admin-row-actions">
        <button className="button button-ghost" onClick={() => { setSelected(new Set()); setShowArchived((value) => !value) }}>{showArchived ? 'View active' : 'View archived'}</button>
        <button className="button button-ghost" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Refreshing…' : 'Refresh'}</button>
      </div>
    </div>
    <div className="operation-summary">
      <div><span className="stat-icon gold"><Clock3 size={19} /></span><span><strong>{String(awaiting).padStart(2, '0')}</strong><small>Awaiting approval</small></span></div>
      <div><span className="stat-icon"><CreditCard size={19} /></span><span><strong>{peso(confirmedTotal)}</strong><small>Confirmed (approved)</small></span></div>
      <div><span className="stat-icon"><Check size={19} /></span><span><strong>{enrollments.length}</strong><small>Total enrollments</small></span></div>
    </div>

    {selected.size > 0 && <div className="admin-bulkbar">
      <span>{selected.size} selected</span>
      <button className="button button-primary button-compact" onClick={() => bulkDecide('approved')} disabled={bulkMutation.isPending}><Check size={14} /> Approve</button>
      <button className="button button-ghost button-compact" onClick={() => bulkDecide('rejected')} disabled={bulkMutation.isPending}><X size={14} /> Reject</button>
      <button className="button button-ghost button-compact" onClick={() => bulkDecide('refunded')} disabled={bulkMutation.isPending}>Refund</button>
    </div>}

    {notice && <p className="auth-notice" role="status">{notice}</p>}
    {error && <p className="form-alert" role="alert">{error}</p>}

    <div className="admin-table admin-table-enrollments">
      <div className="admin-table-head"><span>{selectablePendingIds.length > 0 && <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all pending" />}</span><span>APPLICANT</span><span>PATHWAY</span><span>STATUS</span><span>SUBMITTED</span><span>ACTIONS</span></div>
      {isLoading ? <p className="operations-note">Loading enrollments…</p>
        : !enrollments.length ? <p className="operations-note">{showArchived ? 'No archived enrollments.' : 'No active enrollments.'}</p>
        : enrollments.map((row) => { const isPending = !showArchived && row.status === 'paid_approval_pending'; return <div className="admin-table-row" key={rowId(row)}>
          <span>{isPending && <input type="checkbox" checked={selected.has(rowId(row))} onChange={() => toggle(rowId(row))} aria-label={`Select ${row.applicant?.name}`} />}</span>
          <span><strong>{row.applicant?.name}</strong><small>{row.applicant?.email}</small></span>
          <span>{pathwayLabel[row.applicant?.pathway] ?? row.applicant?.pathway}</span>
          <span>
            <StatusPill kind={pillKind(row.status)}>{statusLabel[row.status] ?? row.status}</StatusPill>
            {row.payment?.plan === 'upfront' && <small style={{ display: 'block', marginTop: 4, color: '#a17e40', fontWeight: 700 }}>Balance due {peso(Number(row.amount ?? 0) - Number(row.payment?.planAmount ?? 0))} — follow up</small>}
          </span>
          <span>{formatDate(row.createdAt)}</span>
          <span className="admin-row-actions">
            {isPending && <>
              <button className="button button-primary button-compact" onClick={() => decide(row, 'approved')}><Check size={14} /> Approve</button>
              <button className="button button-ghost button-compact" onClick={() => decide(row, 'rejected')}><X size={14} /> Reject</button>
            </>}
            {showArchived
              ? <button className="button button-ghost button-compact" onClick={() => archive(row, false)} disabled={archiveMutation.isPending}><ArchiveRestore size={14} /> Restore</button>
              : <button className="button button-ghost button-compact" onClick={() => archive(row, true)} disabled={archiveMutation.isPending}><Archive size={14} /> Archive</button>}
          </span>
        </div> })}
    </div>
  </>
}
