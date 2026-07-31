import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, CalendarClock, Check, CreditCard, Wallet, X } from 'lucide-react'
import EnrollmentDocumentLinks from '../../../components/EnrollmentDocumentLinks.jsx'
import StatusPill from '../../../components/StatusPill.jsx'
import Modal from '../../../components/Modal.jsx'
import { useConfirm } from '../../../lib/confirmContext.js'
import { useToast } from '../../../lib/toastContext.js'
import { archiveEnrollment, bulkDecideEnrollments, decideEnrollment, fetchAdminEnrollments, setEnrollmentBalanceDue } from '../../../lib/admin.js'
import Loading from '../../../components/Loading.jsx'

const pathwayLabel = { broker: 'Broker Review', consultant: 'Consultant Review', appraiser: 'Appraiser Review' }
const statusLabel = {
  application_pending: 'Application started', documents_pending: 'Awaiting signature', documents_complete: 'Agreement signed',
  payment_pending: 'Awaiting payment', contract_pending: 'Awaiting signature', contract_signed: 'Agreement signed',
  paid_approval_pending: 'Paid · awaiting approval', approved: 'Approved', rejected: 'Rejected', refunded: 'Refunded',
}
const pillKind = (status) => (status === 'approved' ? 'green' : status === 'rejected' || status === 'refunded' ? 'red' : status === 'paid_approval_pending' ? 'gold' : 'green')
const rowId = (row) => row._id ?? row.id
const peso = (value) => `₱${Number(value ?? 0).toLocaleString('en-PH')}`
const formatDate = (value) => (value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const formatDueDate = (value) => (value ? new Date(value).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : '')

// Lets staff set the reminder shown on the learner's own Statement of Account for what they still
// owe on a "pay upfront only" plan — purely informational, doesn't collect anything itself.
function BalanceDueModal({ row, onClose, onSaved }) {
  const [dueDate, setDueDate] = useState(row?.payment?.balanceDueDate ? new Date(row.payment.balanceDueDate).toISOString().slice(0, 10) : '')
  const [note, setNote] = useState(row?.payment?.balanceNote ?? '')
  const toast = useToast()
  const mutation = useMutation({ mutationFn: () => setEnrollmentBalanceDue(rowId(row), { balanceDueDate: dueDate || null, balanceNote: note.trim() || null }) })
  const save = async (event) => {
    event.preventDefault()
    try { await mutation.mutateAsync(); toast.success('Balance due date updated.'); onSaved() }
    catch (e) { toast.error(e.message) }
  }
  return <Modal open={Boolean(row)} onClose={onClose} labelledBy="balance-due-title" className="confirm-modal">
    <p className="eyebrow">BALANCE DUE</p>
    <h2 id="balance-due-title">{row?.applicant?.name}</h2>
    <form className="webinar-register-form" onSubmit={save} style={{ textAlign: 'left', marginTop: 16 }}>
      <label className="builder-field"><span>Due date</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
      <label className="builder-field"><span>Note (optional, shown to the learner)</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Please settle by this date to keep your access active." /></label>
      <div className="confirm-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save'}</button></div>
    </form>
  </Modal>
}

export default function AdminEnrollmentsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [showArchived, setShowArchived] = useState(false)
  const [dueDateRow, setDueDateRow] = useState(null)
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
  // Revenue is what was actually charged (payment.planAmount — the upfront fee alone on that
  // plan), not the listed enrollment price, and counts every enrollment that ever completed a
  // payment regardless of its current status (e.g. still counts a later-refunded one).
  const paidEnrollments = enrollments.filter((row) => row.payment?.paidAt)
  const totalRevenue = paidEnrollments.reduce((sum, row) => sum + Number(row.payment?.planAmount ?? 0), 0)
  // What's still owed on "pay upfront only" plans — the gap between the full enrollment price and
  // what was actually charged — summed across confirmed enrollments. Mirrors the per-row "Balance
  // due" note below.
  const outstandingBalance = enrollments.filter((row) => row.status === 'approved').reduce((sum, row) => sum + (Number(row.amount ?? 0) - Number(row.payment?.planAmount ?? 0)), 0)
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
      <div><span className="stat-icon"><Wallet size={19} /></span><span><strong>{peso(totalRevenue)}</strong><small>Total revenue</small></span></div>
      <div><span className="stat-icon"><CreditCard size={19} /></span><span><strong>{peso(outstandingBalance)}</strong><small>Outstanding balance</small></span></div>
      <div><span className="stat-icon"><Check size={19} /></span><span><strong>{paidEnrollments.length}</strong><small>Total enrollments</small></span></div>
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
      <div className="admin-table-head"><span>{selectablePendingIds.length > 0 && <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all pending" />}</span><span>APPLICANT</span><span>PATHWAY</span><span>STATUS</span><span>DOCUMENTS</span><span>SUBMITTED</span><span>ACTIONS</span></div>
      {isLoading ? <Loading label="Loading enrollments…" />
        : !enrollments.length ? <p className="operations-note">{showArchived ? 'No archived enrollments.' : 'No active enrollments.'}</p>
        : enrollments.map((row) => { const isPending = !showArchived && row.status === 'paid_approval_pending'; return <div className="admin-table-row" key={rowId(row)}>
          <span>{isPending && <input type="checkbox" checked={selected.has(rowId(row))} onChange={() => toggle(rowId(row))} aria-label={`Select ${row.applicant?.name}`} />}</span>
          <span><strong>{row.applicant?.name}</strong><small>{row.applicant?.email}</small></span>
          <span>{pathwayLabel[row.applicant?.pathway] ?? row.applicant?.pathway}</span>
          <span>
            <StatusPill kind={pillKind(row.status)}>{statusLabel[row.status] ?? row.status}</StatusPill>
            {row.payment?.plan === 'upfront' && <small style={{ display: 'block', marginTop: 4, color: '#a17e40', fontWeight: 700 }}>
              Balance due {peso(Number(row.amount ?? 0) - Number(row.payment?.planAmount ?? 0))}{row.payment?.balanceDueDate ? ` by ${formatDueDate(row.payment.balanceDueDate)}` : ' — follow up'}
            </small>}
            {row.payment?.plan === 'upfront' && row.payment?.balanceNote && <small style={{ display: 'block', marginTop: 2, color: '#8b9389', fontStyle: 'italic' }}>{row.payment.balanceNote}</small>}
          </span>
          <span><EnrollmentDocumentLinks enrollmentId={rowId(row)} applicantName={row.applicant?.name} documents={row.documents} /></span>
          <span>{formatDate(row.createdAt)}</span>
          <span className="admin-row-actions">
            {isPending && <>
              <button className="button button-primary button-compact" onClick={() => decide(row, 'approved')}><Check size={14} /> Approve</button>
              <button className="button button-ghost button-compact" onClick={() => decide(row, 'rejected')}><X size={14} /> Reject</button>
            </>}
            {row.payment?.plan === 'upfront' && <button className="button button-ghost button-compact" onClick={() => setDueDateRow(row)}><CalendarClock size={14} /> {row.payment?.balanceDueDate ? 'Edit due date' : 'Set due date'}</button>}
            {showArchived
              ? <button className="button button-ghost button-compact" onClick={() => archive(row, false)} disabled={archiveMutation.isPending}><ArchiveRestore size={14} /> Restore</button>
              : <button className="button button-ghost button-compact" onClick={() => archive(row, true)} disabled={archiveMutation.isPending}><Archive size={14} /> Archive</button>}
          </span>
        </div> })}
    </div>
    <BalanceDueModal row={dueDateRow} onClose={() => setDueDateRow(null)} onSaved={() => { setDueDateRow(null); invalidate() }} />
  </>
}
