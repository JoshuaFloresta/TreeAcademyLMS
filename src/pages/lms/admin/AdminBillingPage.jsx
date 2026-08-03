import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CreditCard, Plus, Receipt, Wallet } from 'lucide-react'
import StatusPill from '../../../components/StatusPill.jsx'
import Modal from '../../../components/Modal.jsx'
import Loading from '../../../components/Loading.jsx'
import BillingDetailModal from '../../../components/admin/BillingDetailModal.jsx'
import { useToast } from '../../../lib/toastContext.js'
import { createBillingRecord, fetchAdminUsers, fetchStaffBilling } from '../../../lib/admin.js'

const peso = (value) => `â‚±${Number(value ?? 0).toLocaleString('en-PH')}`
const pathwayLabel = { broker: 'Broker Review', consultant: 'Consultant Review', appraiser: 'Appraiser Review' }

function NewRecordModal({ open, onClose, onCreated }) {
  const toast = useToast()
  const [learnerId, setLearnerId] = useState('')
  const [pathway, setPathway] = useState('consultant')
  const { data: learners = [] } = useQuery({ queryKey: ['admin-users', 'learner'], queryFn: () => fetchAdminUsers({ role: 'learner' }), enabled: open })
  const mutation = useMutation({ mutationFn: () => createBillingRecord({ learnerId, pathway }) })
  const submit = async (event) => {
    event.preventDefault()
    try { await mutation.mutateAsync(); toast.success('Billing record created.'); setLearnerId(''); onCreated() }
    catch (error) { toast.error(error.message) }
  }
  return <Modal open={open} onClose={onClose} labelledBy="new-billing-title" className="confirm-modal">
    <p className="eyebrow">NEW RECORD</p>
    <h2 id="new-billing-title">Bill a learner</h2>
    <p className="enrollment-sent-lead">For someone onboarded outside the public enrollment flow. The price comes from the program&rsquo;s current pricing.</p>
    <form className="webinar-register-form" onSubmit={submit} style={{ textAlign: 'left', marginTop: 16 }}>
      <label className="builder-field"><span>Learner</span><select required value={learnerId} onChange={(event) => setLearnerId(event.target.value)}><option value="">Select a learner</option>{learners.map((learner) => <option key={learner.id ?? learner._id} value={learner.id ?? learner._id}>{learner.name} â€” {learner.email}</option>)}</select></label>
      <label className="builder-field"><span>Program</span><select value={pathway} onChange={(event) => setPathway(event.target.value)}>{Object.entries(pathwayLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="confirm-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={mutation.isPending || !learnerId}>{mutation.isPending ? 'Creatingâ€¦' : 'Create record'}</button></div>
    </form>
  </Modal>
}

// Collections view over the Payment ledger. Totals here come from the ledger, not from enrollment
// status, so they match what each learner sees on their own Statement of Account.
export default function AdminBillingPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [detailRow, setDetailRow] = useState(null)
  const [newOpen, setNewOpen] = useState(false)
  const { data: rows = [], isLoading, isFetching, refetch } = useQuery({ queryKey: ['staff-billing'], queryFn: fetchStaffBilling })
  const invalidate = () => { queryClient.invalidateQueries({ queryKey: ['staff-billing'] }); queryClient.invalidateQueries({ queryKey: ['staff-payments'] }) }

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return rows
    return rows.filter((row) => `${row.name} ${row.email}`.toLowerCase().includes(term))
  }, [rows, search])

  // Mirrors the rule /api/billing/me uses to hide a row from the learner: an enrollment abandoned
  // before any payment isn't collectible debt. Those rows stay in the table below â€” staff still need
  // to see them â€” but counting them would inflate "Outstanding" with signups nobody ever completed.
  const abandoned = (row) => Number(row.amountPaid ?? 0) === 0 && ['application_pending', 'documents_pending'].includes(row.status)
  const collectible = rows.filter((row) => !abandoned(row))
  const billed = collectible.reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
  const collected = collectible.reduce((sum, row) => sum + Number(row.amountPaid ?? 0), 0)
  const abandonedCount = rows.length - collectible.length

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">PLATFORM ADMIN</p><h1>Billing &amp; Payments</h1><p>What each learner owes, what they&rsquo;ve paid, and every payment behind it.</p></div>
      <div className="admin-row-actions">
        <button className="button button-primary" onClick={() => setNewOpen(true)}><Plus size={15} /> New billing record</button>
        <button className="button button-ghost" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Refreshingâ€¦' : 'Refresh'}</button>
      </div>
    </div>

    <div className="operation-summary">
      <div><span className="stat-icon"><Wallet size={19} /></span><span><strong>{peso(collected)}</strong><small>Collected</small></span></div>
      <div><span className="stat-icon"><CreditCard size={19} /></span><span><strong>{peso(Math.max(0, billed - collected))}</strong><small>Outstanding</small></span></div>
      <div><span className="stat-icon"><Receipt size={19} /></span><span><strong>{peso(billed)}</strong><small>Total billed</small></span></div>
    </div>
    {abandonedCount > 0 && <p className="billing-hint">Totals exclude {abandonedCount} signup{abandonedCount === 1 ? '' : 's'} abandoned before payment. They&rsquo;re listed below but aren&rsquo;t counted as owed, and the learner never sees them.</p>}

    <div className="attendance-toolbar">
      <input className="attendance-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or email" aria-label="Search learners" />
    </div>

    <div className="admin-table admin-table-billing">
      <div className="admin-table-head"><span>LEARNER</span><span>PROGRAM</span><span>TOTAL</span><span>PAID</span><span>BALANCE</span><span>ACTIONS</span></div>
      {isLoading ? <Loading label="Loading billingâ€¦" />
        : !visible.length ? <p className="operations-note">{search ? 'No learner matches that search.' : 'No billing records yet.'}</p>
        : visible.map((row) => <div className="admin-table-row" key={row.id}>
          <span><strong>{row.name}</strong><small>{row.email}</small></span>
          <span>{pathwayLabel[row.pathway] ?? row.pathway}{row.origin === 'manual' && <small style={{ display: 'block', color: '#8b9389' }}>Manually billed</small>}</span>
          <span>{peso(row.amount)}</span>
          <span>{peso(row.amountPaid)}</span>
          <span>{abandoned(row)
            ? <StatusPill kind="red">Abandoned</StatusPill>
            : row.balance > 0 ? <StatusPill kind="gold">{peso(row.balance)} due</StatusPill>
            : <StatusPill kind="green">Settled</StatusPill>}</span>
          <span className="admin-row-actions"><button className="button button-ghost button-compact" onClick={() => setDetailRow(row)}><Receipt size={14} /> Manage</button></span>
        </div>)}
    </div>

    {detailRow && <BillingDetailModal enrollmentId={detailRow.id} name={detailRow.name} email={detailRow.email} pathwayTitle={pathwayLabel[detailRow.pathway] ?? detailRow.pathway} onClose={() => setDetailRow(null)} onChanged={invalidate} />}
    <NewRecordModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); invalidate() }} />
  </>
}
