import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, CreditCard, Plus, Receipt, Trash2, Wallet } from 'lucide-react'
import StatusPill from '../../../components/StatusPill.jsx'
import Modal from '../../../components/Modal.jsx'
import Loading from '../../../components/Loading.jsx'
import { useConfirm } from '../../../lib/confirmContext.js'
import { useToast } from '../../../lib/toastContext.js'
import { createBillingRecord, fetchAdminUsers, fetchEnrollmentPayments, fetchStaffBilling, recordPayment, updateEnrollmentBilling, voidPayment } from '../../../lib/admin.js'

const peso = (value) => `₱${Number(value ?? 0).toLocaleString('en-PH')}`
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : '—')
const today = () => new Date().toISOString().slice(0, 10)
const pathwayLabel = { broker: 'Broker Review', consultant: 'Consultant Review', appraiser: 'Appraiser Review' }
const methodLabel = { paymongo: 'PayMongo', cash: 'Cash', bank_transfer: 'Bank transfer', gcash: 'GCash', maya: 'Maya', check: 'Cheque', other: 'Other' }
const kindLabel = { upfront: 'Upfront fee', balance: 'Balance', full: 'Full payment', adjustment: 'Adjustment' }

// Itemises the enrollment total. The running sum is shown against the total as you type because the
// server rejects a breakdown that doesn't reconcile — better to see that before pressing Save.
function BreakdownEditor({ lines, total, onChange }) {
  const sum = lines.reduce((running, line) => running + Number(line.amount || 0), 0)
  const balanced = !lines.length || Math.round(sum * 100) === Math.round(Number(total) * 100)
  const update = (index, patch) => onChange(lines.map((line, position) => (position === index ? { ...line, ...patch } : line)))
  return <div className="billing-breakdown">
    {lines.map((line, index) => <div className="billing-breakdown-row" key={index}>
      <input value={line.label} onChange={(event) => update(index, { label: event.target.value })} placeholder="e.g. Tuition" aria-label="Line label" />
      <input type="number" min="0" value={line.amount} onChange={(event) => update(index, { amount: event.target.value })} placeholder="0" aria-label="Line amount" />
      <button type="button" className="button button-ghost button-compact" onClick={() => onChange(lines.filter((_, position) => position !== index))} aria-label="Remove line"><Trash2 size={13} /></button>
    </div>)}
    <div className="billing-breakdown-foot">
      <button type="button" className="button button-ghost button-compact" onClick={() => onChange([...lines, { label: '', amount: '' }])}><Plus size={13} /> Add line</button>
      {lines.length > 0 && <span className={balanced ? 'billing-sum' : 'billing-sum off'}>{peso(sum)} of {peso(total)}{balanced ? '' : ' — must match to save'}</span>}
    </div>
  </div>
}

function AddPaymentForm({ enrollmentId, onSaved }) {
  const [values, setValues] = useState({ amount: '', method: 'cash', kind: 'balance', receivedAt: today(), reference: '', note: '' })
  const toast = useToast()
  const mutation = useMutation({ mutationFn: () => recordPayment(enrollmentId, { ...values, amount: Number(values.amount) }) })
  const set = (patch) => setValues((current) => ({ ...current, ...patch }))
  const submit = async (event) => {
    event.preventDefault()
    try {
      await mutation.mutateAsync()
      toast.success('Payment recorded.')
      setValues({ amount: '', method: 'cash', kind: 'balance', receivedAt: today(), reference: '', note: '' })
      onSaved()
    } catch (error) { toast.error(error.message) }
  }
  return <form className="billing-payment-form" onSubmit={submit}>
    <label className="builder-field"><span>Amount received</span><input type="number" min="1" required value={values.amount} onChange={(event) => set({ amount: event.target.value })} placeholder="5000" /></label>
    <label className="builder-field"><span>Date received</span><input type="date" required value={values.receivedAt} onChange={(event) => set({ receivedAt: event.target.value })} /></label>
    <label className="builder-field"><span>Method</span><select value={values.method} onChange={(event) => set({ method: event.target.value })}>{Object.entries(methodLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="builder-field"><span>Type</span><select value={values.kind} onChange={(event) => set({ kind: event.target.value })}>{Object.entries(kindLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="builder-field"><span>Reference (optional)</span><input value={values.reference} onChange={(event) => set({ reference: event.target.value })} placeholder="Deposit slip / txn no." /></label>
    <label className="builder-field"><span>Note (optional)</span><input value={values.note} onChange={(event) => set({ note: event.target.value })} placeholder="Anything worth recording" /></label>
    <button className="button button-primary button-compact" disabled={mutation.isPending}>{mutation.isPending ? 'Recording…' : 'Record payment'}</button>
  </form>
}

function BillingDetailModal({ row, onClose, onChanged }) {
  const toast = useToast()
  const confirm = useConfirm()
  const { data, isLoading, refetch } = useQuery({ queryKey: ['staff-payments', row?.id], queryFn: () => fetchEnrollmentPayments(row.id), enabled: Boolean(row) })
  const [lines, setLines] = useState(null)
  const enrollment = data?.enrollment
  const breakdown = lines ?? (enrollment?.feeBreakdown ?? []).map((line) => ({ label: line.label, amount: String(line.amount) }))

  const saveBreakdown = useMutation({
    mutationFn: () => updateEnrollmentBilling(row.id, { feeBreakdown: breakdown.filter((line) => line.label.trim()).map((line) => ({ label: line.label.trim(), amount: Number(line.amount || 0) })) }),
  })

  const changed = () => { refetch(); onChanged() }

  const save = async () => {
    try { await saveBreakdown.mutateAsync(); toast.success('Breakdown saved.'); setLines(null); changed() }
    catch (error) { toast.error(error.message) }
  }

  const removePayment = async (payment) => {
    if (!(await confirm({ title: 'Void this payment?', message: `${peso(payment.amount)} received ${formatDate(payment.receivedAt)} will stop counting toward what has been paid. The record stays visible with your reason.`, confirmLabel: 'Void payment' }))) return
    const reason = window.prompt('Why is this payment being voided?') ?? ''
    if (reason.trim().length < 3) return toast.error('A reason of at least 3 characters is required to void a payment.')
    try { await voidPayment(payment.id, reason.trim()); toast.success('Payment voided.'); changed() }
    catch (error) { toast.error(error.message) }
  }

  return <Modal open={Boolean(row)} onClose={onClose} labelledBy="billing-detail-title">
    <p className="eyebrow">BILLING RECORD</p>
    <h2 id="billing-detail-title">{row?.name}</h2>
    <p className="enrollment-sent-lead">{pathwayLabel[row?.pathway] ?? row?.pathway} · {row?.email}</p>
    {isLoading ? <Loading label="Loading ledger…" /> : <div className="billing-detail">
      <div className="statement-figures">
        <div><span>Total</span><strong>{peso(enrollment?.amount)}</strong></div>
        <div><span>Paid</span><strong>{peso(enrollment?.amountPaid)}</strong></div>
        <div><span>Balance</span><strong className={enrollment?.balance > 0 ? 'statement-balance-due' : ''}>{peso(enrollment?.balance)}</strong></div>
      </div>

      <section className="billing-section">
        <h3>Fee breakdown</h3>
        <p className="billing-hint">Optional. Leave empty for a single line covering the whole amount.</p>
        <BreakdownEditor lines={breakdown} total={enrollment?.amount ?? 0} onChange={setLines} />
        {lines && <div className="confirm-actions"><button type="button" className="button button-ghost button-compact" onClick={() => setLines(null)}>Cancel</button><button type="button" className="button button-primary button-compact" onClick={save} disabled={saveBreakdown.isPending}>{saveBreakdown.isPending ? 'Saving…' : 'Save breakdown'}</button></div>}
      </section>

      <section className="billing-section">
        <h3>Payments</h3>
        {!data?.payments?.length ? <p className="billing-hint">Nothing recorded yet — this learner shows the full amount outstanding.</p> : <div className="billing-payments">
          {data.payments.map((payment) => <div className={payment.voidedAt ? 'billing-payment voided' : 'billing-payment'} key={payment.id}>
            <div>
              <strong>{peso(payment.amount)}</strong>
              <small>{kindLabel[payment.kind] ?? payment.kind} · {methodLabel[payment.method] ?? payment.method} · {formatDate(payment.receivedAt)}</small>
              {payment.reference && <small>Ref: {payment.reference}</small>}
              {payment.note && <small className="billing-note">{payment.note}</small>}
              {payment.voidedAt && <small className="billing-void-note"><Ban size={12} /> Voided {formatDate(payment.voidedAt)} — {payment.voidReason}</small>}
            </div>
            {!payment.voidedAt && <button type="button" className="button button-ghost button-compact" onClick={() => removePayment(payment)}><Ban size={13} /> Void</button>}
          </div>)}
        </div>}
      </section>

      <section className="billing-section">
        <h3>Record a payment</h3>
        <AddPaymentForm enrollmentId={row.id} onSaved={changed} />
      </section>
    </div>}
  </Modal>
}

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
      <label className="builder-field"><span>Learner</span><select required value={learnerId} onChange={(event) => setLearnerId(event.target.value)}><option value="">Select a learner</option>{learners.map((learner) => <option key={learner.id ?? learner._id} value={learner.id ?? learner._id}>{learner.name} — {learner.email}</option>)}</select></label>
      <label className="builder-field"><span>Program</span><select value={pathway} onChange={(event) => setPathway(event.target.value)}>{Object.entries(pathwayLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="confirm-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={mutation.isPending || !learnerId}>{mutation.isPending ? 'Creating…' : 'Create record'}</button></div>
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
  // before any payment isn't collectible debt. Those rows stay in the table below — staff still need
  // to see them — but counting them would inflate "Outstanding" with signups nobody ever completed.
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

    {detailRow && <BillingDetailModal row={detailRow} onClose={() => setDetailRow(null)} onChanged={invalidate} />}
    <NewRecordModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); invalidate() }} />
  </>
}
