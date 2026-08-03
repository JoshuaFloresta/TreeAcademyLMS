import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Ban, Plus, Trash2 } from 'lucide-react'
import Modal from '../Modal.jsx'
import Loading from '../Loading.jsx'
import { useConfirm } from '../../lib/confirmContext.js'
import { useToast } from '../../lib/toastContext.js'
import { fetchEnrollmentPayments, recordPayment, updateEnrollmentBilling, voidPayment } from '../../lib/admin.js'

const peso = (value) => `₱${Number(value ?? 0).toLocaleString('en-PH')}`
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : '—')
const today = () => new Date().toISOString().slice(0, 10)
const methodLabel = { paymongo: 'PayMongo', cash: 'Cash', bank_transfer: 'Bank transfer', gcash: 'GCash', maya: 'Maya', check: 'Cheque', other: 'Other' }
const kindLabel = { upfront: 'Upfront fee', balance: 'Balance', full: 'Full payment', adjustment: 'Adjustment' }

// Itemises the total. A line may be negative — that is how a discount is described rather than just
// quietly lowering the total. The running sum is shown against the total as you type because the
// server rejects a breakdown that doesn't reconcile.
function BreakdownEditor({ lines, total, onChange }) {
  const sum = lines.reduce((running, line) => running + Number(line.amount || 0), 0)
  const balanced = !lines.length || Math.round(sum * 100) === Math.round(Number(total) * 100)
  const update = (index, patch) => onChange(lines.map((line, position) => (position === index ? { ...line, ...patch } : line)))
  return <div className="billing-breakdown">
    {lines.map((line, index) => <div className="billing-breakdown-row" key={index}>
      <input value={line.label} onChange={(event) => update(index, { label: event.target.value })} placeholder="e.g. Tuition, or Early-bird discount" aria-label="Line label" />
      <input type="number" value={line.amount} onChange={(event) => update(index, { amount: event.target.value })} placeholder="0" aria-label="Line amount" />
      <button type="button" className="button button-ghost button-compact" onClick={() => onChange(lines.filter((_, position) => position !== index))} aria-label="Remove line"><Trash2 size={13} /></button>
    </div>)}
    <div className="billing-breakdown-foot">
      <button type="button" className="button button-ghost button-compact" onClick={() => onChange([...lines, { label: '', amount: '' }])}><Plus size={13} /> Add line</button>
      {lines.length > 0 && <span className={balanced ? 'billing-sum' : 'billing-sum off'}>{peso(sum)} of {peso(total)}{balanced ? '' : ' — must match the total to save'}</span>}
    </div>
  </div>
}

function AddPaymentForm({ enrollmentId, onSaved }) {
  const blank = { amount: '', method: 'cash', kind: 'balance', receivedAt: today(), reference: '', note: '' }
  const [values, setValues] = useState(blank)
  const toast = useToast()
  const mutation = useMutation({ mutationFn: () => recordPayment(enrollmentId, { ...values, amount: Number(values.amount) }) })
  const set = (patch) => setValues((current) => ({ ...current, ...patch }))
  const submit = async (event) => {
    event.preventDefault()
    try { await mutation.mutateAsync(); toast.success('Payment recorded.'); setValues(blank); onSaved() }
    catch (error) { toast.error(error.message) }
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

// Shared by the Billing page and Enrollment Management so both edit one learner's money in exactly
// the same way. Two distinct levers, deliberately separate: change the TOTAL to alter what is owed
// (a discount or an extra charge), record a PAYMENT to log money actually received.
export default function BillingDetailModal({ enrollmentId, name, email, pathwayTitle, onClose, onChanged }) {
  const toast = useToast()
  const confirm = useConfirm()
  const { data, isLoading, refetch } = useQuery({ queryKey: ['staff-payments', enrollmentId], queryFn: () => fetchEnrollmentPayments(enrollmentId), enabled: Boolean(enrollmentId) })
  const [draft, setDraft] = useState(null)
  const enrollment = data?.enrollment

  const editing = draft ?? {
    amount: String(enrollment?.amount ?? ''),
    lines: (enrollment?.feeBreakdown ?? []).map((line) => ({ label: line.label, amount: String(line.amount) })),
  }
  const dirty = draft !== null

  const save = useMutation({
    mutationFn: () => updateEnrollmentBilling(enrollmentId, {
      amount: Number(editing.amount),
      feeBreakdown: editing.lines.filter((line) => line.label.trim()).map((line) => ({ label: line.label.trim(), amount: Number(line.amount || 0) })),
    }),
  })

  const changed = () => { refetch(); onChanged?.() }

  const commit = async () => {
    try { await save.mutateAsync(); toast.success('Billing updated.'); setDraft(null); changed() }
    catch (error) { toast.error(error.message) }
  }

  const removePayment = async (payment) => {
    if (!(await confirm({ title: 'Void this payment?', message: `${peso(payment.amount)} received ${formatDate(payment.receivedAt)} will stop counting toward what has been paid. The record stays visible with your reason.`, confirmLabel: 'Void payment' }))) return
    const reason = window.prompt('Why is this payment being voided?') ?? ''
    if (reason.trim().length < 3) return toast.error('A reason of at least 3 characters is required to void a payment.')
    try { await voidPayment(payment.id, reason.trim()); toast.success('Payment voided.'); changed() }
    catch (error) { toast.error(error.message) }
  }

  const overpaid = enrollment && Number(editing.amount || 0) < Number(enrollment.amountPaid ?? 0)

  return <Modal open={Boolean(enrollmentId)} onClose={onClose} labelledBy="billing-detail-title">
    <p className="eyebrow">BILLING RECORD</p>
    <h2 id="billing-detail-title">{name}</h2>
    <p className="enrollment-sent-lead">{pathwayTitle} · {email}</p>
    {isLoading ? <Loading label="Loading ledger…" /> : <div className="billing-detail">
      <div className="statement-figures">
        <div><span>Total</span><strong>{peso(enrollment?.amount)}</strong></div>
        <div><span>Paid</span><strong>{peso(enrollment?.amountPaid)}</strong></div>
        <div><span>Balance</span><strong className={enrollment?.balance > 0 ? 'statement-balance-due' : ''}>{peso(enrollment?.balance)}</strong></div>
      </div>

      <section className="billing-section">
        <h3>What this learner owes</h3>
        <p className="billing-hint">Change the total to raise or lower the balance — a discount, a written-off amount, or an extra charge. Itemise it below so the reason is on record. A line can be negative.</p>
        <label className="builder-field billing-total-field"><span>Total payable</span><input type="number" min="1" value={editing.amount} onChange={(event) => setDraft({ ...editing, amount: event.target.value })} /></label>
        {overpaid && <p className="billing-hint billing-warn">This is below the {peso(enrollment.amountPaid)} already paid — the balance will show as settled and the difference will need refunding separately.</p>}
        <BreakdownEditor lines={editing.lines} total={Number(editing.amount || 0)} onChange={(lines) => setDraft({ ...editing, lines })} />
        {dirty && <div className="confirm-actions"><button type="button" className="button button-ghost button-compact" onClick={() => setDraft(null)}>Cancel</button><button type="button" className="button button-primary button-compact" onClick={commit} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save changes'}</button></div>}
      </section>

      <section className="billing-section">
        <h3>Payments received</h3>
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
        <AddPaymentForm enrollmentId={enrollmentId} onSaved={changed} />
      </section>
    </div>}
  </Modal>
}
