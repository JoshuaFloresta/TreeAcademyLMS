import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clock3, CreditCard, FileSignature, ShieldCheck, X } from 'lucide-react'
import StatusPill from '../../components/StatusPill.jsx'
import { useConfirm } from '../../lib/confirmContext.js'
import { useToast } from '../../lib/toastContext.js'
import { authedFetch } from '../../lib/auth.js'

const pathwayLabel = { broker: 'Broker Review', consultant: 'Consultant Review', agent: 'Agent Review' }
const statusLabel = {
  application_pending: 'Application started',
  documents_pending: 'Awaiting signature',
  documents_complete: 'Agreement signed',
  payment_pending: 'Awaiting payment',
  contract_pending: 'Awaiting signature',
  contract_signed: 'Agreement signed',
  paid_approval_pending: 'Paid · awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  refunded: 'Refunded',
}
const pillKind = (status) => (status === 'approved' ? 'green' : status === 'paid_approval_pending' ? 'gold' : 'green')
const rowId = (row) => row._id ?? row.id
const peso = (value) => `₱${Number(value ?? 0).toLocaleString('en-PH')}`
const formatDate = (value) => (value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

async function fetchEnrollments() {
  const response = await authedFetch('/api/staff/enrollments')
  if (response.status === 401 || response.status === 403) throw new Error('Sign in with a staff account to review enrollments.')
  const data = await response.json().catch(() => ([]))
  if (!response.ok) throw new Error(data.error || 'Unable to load enrollments.')
  return Array.isArray(data) ? data : []
}

async function decideEnrollment({ id, decision, reason }) {
  const response = await authedFetch(`/api/staff/enrollments/${id}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, reason: reason || undefined }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Unable to record that decision.')
  return result
}

export default function OperationsPage({ role }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const [busyId, setBusyId] = useState('')
  const { data: enrollments = [], isLoading, isFetching, error, refetch } = useQuery({ queryKey: ['staff-enrollments'], queryFn: fetchEnrollments })
  const decisionMutation = useMutation({ mutationFn: decideEnrollment })

  const decide = async (row, decision) => {
    if (decision === 'rejected' && !(await confirm({ title: 'Reject this enrollment?', message: `${row.applicant?.name}'s paid enrollment will be rejected. This cannot be undone.`, confirmLabel: 'Reject enrollment' }))) return
    const reason = decision === 'approved' ? undefined : (window.prompt(`Reason for ${decision === 'rejected' ? 'rejecting' : 'refunding'} this enrollment (optional):`) ?? '')
    setBusyId(rowId(row)); setNotice(''); setActionError('')
    try {
      const result = await decisionMutation.mutateAsync({ id: rowId(row), decision, reason })
      if (decision === 'approved') {
        const delivery = result.invitation?.delivery
        const message = delivery === 'sent' ? `${row.applicant?.name} was approved and their credentials email was sent.`
          : delivery === 'existing_active_account' ? `${row.applicant?.name} already has an active account.`
          : `${row.applicant?.name} was approved. Email delivery is not configured — check the API logs for the temporary password.`
        setNotice(message); toast.success(message)
      } else {
        const message = `Enrollment for ${row.applicant?.name} was ${decision}.`
        setNotice(message); toast.success(message)
      }
      await queryClient.invalidateQueries({ queryKey: ['staff-enrollments'] })
    } catch (decisionError) {
      setActionError(decisionError.message); toast.error(decisionError.message)
    } finally {
      setBusyId('')
    }
  }

  const awaitingApproval = enrollments.filter((row) => row.status === 'paid_approval_pending').length
  const agreementsPending = enrollments.filter((row) => ['documents_pending', 'contract_pending'].includes(row.status)).length
  const confirmedTotal = enrollments.filter((row) => row.status === 'approved').reduce((sum, row) => sum + Number(row.amount ?? 0), 0)

  return <>
    <div className="page-title-row">
      <div>
        <p className="eyebrow">STAFF WORKSPACE · {role.toUpperCase()}</p>
        <h1>Enrollment review</h1>
        <p>Confirm agreements and payments before learner accounts are created.</p>
      </div>
      <button className="button button-ghost" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Refreshing…' : 'Refresh'}</button>
    </div>
    <div className="operation-summary">
      <div><span className="stat-icon gold"><Clock3 size={19} /></span><span><strong>{String(awaitingApproval).padStart(2, '0')}</strong><small>Awaiting approval</small></span></div>
      <div><span className="stat-icon"><FileSignature size={19} /></span><span><strong>{String(agreementsPending).padStart(2, '0')}</strong><small>Agreements pending</small></span></div>
      <div><span className="stat-icon"><CreditCard size={19} /></span><span><strong>{peso(confirmedTotal)}</strong><small>Confirmed (approved)</small></span></div>
    </div>
    {notice && <p className="auth-notice" role="status">{notice}</p>}
    {(actionError || error) && <p className="form-alert" role="alert">{actionError || error.message}</p>}
    <div className="operations-table">
      <div className="operations-table-head"><span>APPLICANT</span><span>PATHWAY</span><span>STATUS</span><span>SUBMITTED</span><span /></div>
      {isLoading ? <p className="operations-note">Loading enrollments…</p>
        : !enrollments.length ? <p className="operations-note">No enrollments yet.</p>
        : enrollments.map((row) => <div className="operations-row" key={rowId(row)}>
          <span><strong>{row.applicant?.name}</strong><small>{row.applicant?.email}</small></span>
          <span>{pathwayLabel[row.applicant?.pathway] ?? row.applicant?.pathway}</span>
          <span><StatusPill kind={pillKind(row.status)}>{statusLabel[row.status] ?? row.status}</StatusPill></span>
          <span>{formatDate(row.createdAt)}</span>
          <span className="operations-actions">{row.status === 'paid_approval_pending' ? <>
            <button className="button button-primary button-compact" onClick={() => decide(row, 'approved')} disabled={busyId === rowId(row)}><Check size={15} /> Approve</button>
            <button className="button button-ghost button-compact" onClick={() => decide(row, 'rejected')} disabled={busyId === rowId(row)}><X size={15} /> Reject</button>
          </> : null}</span>
        </div>)}
    </div>
    <p className="operations-note"><ShieldCheck size={17} /> Approving an enrollment creates the learner account and emails their temporary credentials. Payment alone never creates an account.</p>
  </>
}
