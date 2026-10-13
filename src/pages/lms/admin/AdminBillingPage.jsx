import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CreditCard, Plus, Receipt, Trash2, Wallet } from 'lucide-react'
import StatusPill from '../../../components/StatusPill.jsx'
import Modal from '../../../components/Modal.jsx'
import Loading from '../../../components/Loading.jsx'
import BillingDetailModal from '../../../components/admin/BillingDetailModal.jsx'
import { useConfirm } from '../../../lib/confirmContext.js'
import { useToast } from '../../../lib/toastContext.js'
import { createBillingRecord, deleteBillingRecord, fetchAdminUsers, fetchStaffBilling } from '../../../lib/admin.js'

const peso = (value) => `₱${Number(value ?? 0).toLocaleString('en-PH')}`
const pathwayLabel = { broker: 'Broker Review', consultant: 'Consultant Review', appraiser: 'Appraiser Review' }

function NewRecordModal({ open, onClose, onCreated }) {
  const toast = useToast()
  const [learnerId, setLearnerId] = useState('')
  const [pathway, setPathway] = useState('consultant')
  const [batch, setBatch] = useState('REBLEx Batch 1')
  const { data: learners = [] } = useQuery({ queryKey: ['admin-users', 'learner'], queryFn: () => fetchAdminUsers({ role: 'learner' }), enabled: open })
  const mutation = useMutation({ mutationFn: () => createBillingRecord({ learnerId, pathway, batch: batch.trim() || 'REBLEx Batch 1' }) })
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
      <label className="builder-field"><span>Learner</span><select required value={learnerId} onChange={(event) => setLearnerId(event.target.value)}><option value="">Select a learner</option>{learners.map((learner) => <option key={learner.id ?? learner._id} value={learner.id ?? learner._id}>{learner.name} — {learner.email}</option>)}</select></label>
      <label className="builder-field"><span>Program</span><select value={pathway} onChange={(event) => setPathway(event.target.value)}>{Object.entries(pathwayLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="builder-field"><span>Batch / Current Session</span><input type="text" required value={batch} onChange={(event) => setBatch(event.target.value)} placeholder="e.g. REBLEx Batch 1" /></label>
      <div className="confirm-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={mutation.isPending || !learnerId}>{mutation.isPending ? 'Creating…' : 'Create record'}</button></div>
    </form>
  </Modal>
}

// Collections view over the Payment ledger. Totals here come from the ledger, not from enrollment
// status, so they match what each learner sees on their own Statement of Account.
export default function AdminBillingPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const [detailRow, setDetailRow] = useState(null)
  const [newOpen, setNewOpen] = useState(false)
  const { data: rows = [], isLoading, isFetching, refetch } = useQuery({ queryKey: ['staff-billing'], queryFn: fetchStaffBilling })
  const invalidate = () => { queryClient.invalidateQueries({ queryKey: ['staff-billing'] }); queryClient.invalidateQueries({ queryKey: ['staff-payments'] }) }

  const removeBilling = async (row) => {
    const title = pathwayLabel[row.pathway] ?? row.pathway ?? 'this program'
    if (!(await confirm({
      title: 'Remove billing record?',
      message: `Are you sure you want to remove the billing record for ${row.name} (${title})? This will archive it and remove it from active billing.`,
      confirmLabel: 'Remove billing',
      danger: true,
    }))) return
    try {
      await deleteBillingRecord(row.id)
      toast.success('Billing record removed.')
      invalidate()
    } catch (e) {
      toast.error(e.message)
    }
  }

  const abandoned = (row) => Number(row.amountPaid ?? 0) === 0 && ['application_pending', 'documents_pending', 'payment_pending', 'contract_pending'].includes(row.status)
  const collectible = useMemo(() => rows.filter((row) => row.status === 'approved' || Number(row.amountPaid ?? 0) > 0), [rows])
  const billed = useMemo(() => collectible.reduce((sum, row) => sum + Number(row.amount ?? 0), 0), [collectible])
  const collected = useMemo(() => collectible.reduce((sum, row) => sum + Number(row.amountPaid ?? 0), 0), [collectible])
  const abandonedCount = rows.length - collectible.length

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return collectible
    return collectible.filter((row) => `${row.name} ${row.email}`.toLowerCase().includes(term))
  }, [collectible, search])

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">PLATFORM ADMIN</p><h1>Billing &amp; Payments</h1><p>What each learner owes, what they&rsquo;ve paid, and every payment behind it.</p></div>
      <div className="admin-row-actions">
        <button className="button button-primary" onClick={() => setNewOpen(true)}><Plus size={15} /> New billing record</button>
        <button className="button button-ghost" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Refreshing…' : 'Refresh'}</button>
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
      {isLoading ? <Loading label="Loading billing…" />
        : !visible.length ? <p className="operations-note">{search ? 'No learner matches that search.' : 'No billing records yet.'}</p>
        : visible.map((row) => <div className="admin-table-row" key={row.id}>
          <span><strong>{row.name}</strong><small>{row.email}</small></span>
          <span>
            <strong>{pathwayLabel[row.pathway] ?? row.pathway}</strong>
            {row.batch && <small className="admin-billing-manual-tag" style={{ marginLeft: 6 }}>{row.batch}</small>}
            {row.origin === 'manual' && <small style={{ display: 'block', color: '#8b9389' }}>Manually billed</small>}
          </span>
          <span>{peso(row.amount)}</span>
          <span>{peso(row.amountPaid)}</span>
          <span>{abandoned(row)
            ? <StatusPill kind="red">Abandoned</StatusPill>
            : row.balance > 0 ? <StatusPill kind="gold">{peso(row.balance)} due</StatusPill>
            : <StatusPill kind="green">Settled</StatusPill>}</span>
          <span className="admin-row-actions">
            <button className="button button-ghost button-compact" onClick={() => setDetailRow(row)}><Receipt size={14} /> Manage</button>
            <button className="button button-ghost button-compact button-danger" onClick={() => removeBilling(row)}><Trash2 size={14} /> Remove</button>
          </span>
        </div>)}
    </div>

    {detailRow && <BillingDetailModal key={detailRow.id} enrollmentId={detailRow.id} name={detailRow.name} email={detailRow.email} pathwayTitle={pathwayLabel[detailRow.pathway] ?? detailRow.pathway} onClose={() => setDetailRow(null)} onChanged={invalidate} />}
    <NewRecordModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); invalidate() }} />
  </>
}
