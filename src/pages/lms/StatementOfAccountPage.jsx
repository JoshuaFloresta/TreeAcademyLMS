import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, CreditCard, Receipt, ShieldCheck } from 'lucide-react'
import { confirmDemoBalancePayment, createBalancePaymentSession, fetchMyBilling } from '../../lib/lms.js'
import { useToast } from '../../lib/toastContext.js'
import StatusPill from '../../components/StatusPill.jsx'
import Loading from '../../components/Loading.jsx'
import Modal from '../../components/Modal.jsx'

const statusMeta = {
  application_pending: { label: 'Application started', kind: 'gold' },
  documents_pending: { label: 'Awaiting signature', kind: 'gold' },
  documents_complete: { label: 'Agreement signed', kind: 'gold' },
  payment_pending: { label: 'Awaiting payment', kind: 'gold' },
  contract_pending: { label: 'Awaiting signature', kind: 'gold' },
  contract_signed: { label: 'Agreement signed', kind: 'gold' },
  paid_approval_pending: { label: 'Paid · awaiting approval', kind: 'gold' },
  approved: { label: 'Enrolled', kind: 'green' },
  rejected: { label: 'Rejected', kind: 'red' },
  refunded: { label: 'Refunded', kind: 'red' },
}
const peso = (value) => `₱${Number(value ?? 0).toLocaleString('en-PH')}`
// Derived from the ledger, not from payment.plan. `plan` is only ever set by PayMongo checkout, so
// a learner billed manually had one — showing "Not yet paid" above figures that said ₱5,000 paid.
const paymentSummary = (row) => {
  if (!Number(row.amountPaid)) return 'Not yet paid'
  if (Number(row.balance) <= 0) return 'Paid in full'
  return `Partially paid — ${peso(row.balance)} remaining`
}
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : '—')

function PayBalanceModal({ row, onClose, onSuccess }) {
  const [payType, setPayType] = useState('full')
  const [customAmount, setCustomAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const toast = useToast()

  const balance = Number(row?.balance ?? 0)
  const minAmount = Math.min(100, balance)
  const targetAmount = payType === 'full' ? balance : (Number(customAmount) || 0)
  const isValidAmount = targetAmount >= minAmount && targetAmount <= balance

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!isValidAmount) {
      setError(`Please enter an amount between ₱${minAmount.toLocaleString('en-PH')} and ₱${balance.toLocaleString('en-PH')}.`)
      return
    }

    setLoading(true)
    try {
      const session = await createBalancePaymentSession(row.id, { amount: targetAmount })
      if (session.mode === 'demo_checkout') {
        // Direct simulation for local/demo environments
        await confirmDemoBalancePayment(row.id, { amount: targetAmount })
        toast.success(`Payment of ₱${targetAmount.toLocaleString('en-PH')} completed successfully!`)
        onSuccess()
        onClose()
      } else if (session.checkoutUrl) {
        window.location.href = session.checkoutUrl
      } else {
        throw new Error(session.error || 'Failed to initialize payment gateway.')
      }
    } catch (err) {
      setError(err.message || 'Payment initiation failed.')
      setLoading(false)
    }
  }

  return (
    <Modal open={Boolean(row)} onClose={onClose} labelledBy="pay-balance-title" className="confirm-modal">
      <p className="eyebrow">ONLINE PAYMENT</p>
      <h2 id="pay-balance-title">Pay Remaining Balance</h2>
      <p className="enrollment-sent-lead" style={{ margin: '4px 0 16px' }}>
        {row?.pathwayTitle} {row?.batch && `(${row.batch})`}
      </p>

      <div style={{ background: '#f4f7f4', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13, textAlign: 'left' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ color: '#657367' }}>Total course fee:</span>
          <strong>{peso(row?.amount)}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ color: '#657367' }}>Amount already paid:</span>
          <span style={{ color: '#1b432e', fontWeight: 600 }}>{peso(row?.amountPaid)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #dde3dc', paddingTop: 6 }}>
          <span style={{ fontWeight: 700, color: '#334035' }}>Remaining balance:</span>
          <strong style={{ color: '#a83f32', fontSize: 15 }}>{peso(balance)}</strong>
        </div>
      </div>

      <form className="webinar-register-form" onSubmit={handleSubmit} style={{ textAlign: 'left' }}>
        <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
            <input
              type="radio"
              name="payType"
              checked={payType === 'full'}
              onChange={() => setPayType('full')}
            />
            <span>Pay full balance: <strong>{peso(balance)}</strong></span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
            <input
              type="radio"
              name="payType"
              checked={payType === 'custom'}
              onChange={() => setPayType('custom')}
            />
            <span>Pay partial / custom amount</span>
          </label>
        </div>

        {payType === 'custom' && (
          <label className="builder-field" style={{ marginBottom: 14 }}>
            <span>Payment amount (₱)</span>
            <input
              type="number"
              min={minAmount}
              max={balance}
              step={1}
              required
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              placeholder={`Min ${minAmount}, up to ${balance}`}
            />
            <small style={{ color: '#7a857b', fontSize: 11, marginTop: 4 }}>
              Minimum payment is ₱{minAmount.toLocaleString('en-PH')} up to remaining balance of {peso(balance)}.
            </small>
          </label>
        )}

        <div style={{ background: '#fcfbf7', border: '1px solid #ece8db', borderRadius: 6, padding: '10px 12px', marginBottom: 16, fontSize: 11, color: '#6e685a', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={18} style={{ color: '#2d6a4f', flexShrink: 0 }} />
          <span>PayMongo Gateway: Accepts GCash, Maya, QR Ph, &amp; Credit/Debit cards.</span>
        </div>

        {error && <p className="form-alert" role="alert">{error}</p>}

        <div className="confirm-actions">
          <button type="button" className="button button-ghost" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={loading || !isValidAmount}>
            <CreditCard size={14} /> {loading ? 'Preparing payment…' : `Pay ${peso(targetAmount)}`}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// A learner's own billing history — every enrollment tied to their email, with the fee, what
// they've actually paid, and (for a "pay upfront only" plan) the remaining balance and any due
// date/note staff set on it. Now includes in-app balance settlement powered by PayMongo.
export default function StatementOfAccountPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [payingRow, setPayingRow] = useState(null)

  const paymentStatus = searchParams.get('payment')
  const isDemo = searchParams.get('demo') === 'true'
  const enrollmentId = searchParams.get('enrollment')
  const amountParam = searchParams.get('amount')

  const { data: statements = [], isLoading, error } = useQuery({ queryKey: ['my-billing'], queryFn: fetchMyBilling })

  useEffect(() => {
    if (!paymentStatus) return
    if (paymentStatus === 'success') {
      if (isDemo && enrollmentId) {
        confirmDemoBalancePayment(enrollmentId, { amount: amountParam ? Number(amountParam) : undefined })
          .then(() => {
            toast.success('Your balance payment was processed successfully!')
            queryClient.invalidateQueries({ queryKey: ['my-billing'] })
          })
          .catch((e) => toast.error(e.message))
      } else {
        toast.success('Your balance payment was processed successfully!')
        queryClient.invalidateQueries({ queryKey: ['my-billing'] })
      }
      setSearchParams({}, { replace: true })
    } else if (paymentStatus === 'cancelled') {
      toast.info('Payment was cancelled. You can settle your balance whenever you are ready.')
      setSearchParams({}, { replace: true })
    }
  }, [paymentStatus, isDemo, enrollmentId, amountParam, toast, queryClient, setSearchParams])

  return <>
    <div className="page-title-row"><div><p className="eyebrow">YOUR ACCOUNT</p><h1>Statement of Account</h1><p>Your enrollment fee, what you’ve paid, and anything still outstanding.</p></div></div>
    {isLoading && <Loading block label="Loading your statement…" />}
    {error && <div className="empty-state"><Receipt size={26} /><strong>Could not load your statement</strong><p>{error.message}</p></div>}
    {!isLoading && !error && !statements.length && <div className="empty-state"><Receipt size={26} /><strong>Nothing here yet</strong><p>Once you start an enrollment, its billing details will show up here.</p></div>}
    <div className="statement-list">
      {statements.map((row) => {
        const meta = statusMeta[row.status] ?? { label: row.status, kind: 'gold' }
        const hasBalance = Number(row.balance ?? 0) > 0
        return <article className="statement-card" key={row.id}>
          <div className="statement-card-head">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2>{row.pathwayTitle}</h2>
                {row.batch && <small className="admin-billing-manual-tag">{row.batch}</small>}
              </div>
              <small>{paymentSummary(row)}</small>
            </div>
            <StatusPill kind={meta.kind}>{meta.label}</StatusPill>
          </div>
          <div className="statement-figures">
            <div><span>Full enrollment price</span><strong>{peso(row.amount)}</strong></div>
            <div><span>Amount paid</span><strong>{peso(row.amountPaid)}</strong></div>
            <div><span>Balance remaining</span><strong className={hasBalance ? 'statement-balance-due' : ''}>{peso(row.balance)}</strong></div>
          </div>
          {hasBalance && row.balanceDueDate && <p className="statement-due-note"><CalendarClock size={15} /> Please settle by <strong>{formatDate(row.balanceDueDate)}</strong>{row.balanceNote ? ` — ${row.balanceNote}` : ''}</p>}
          {hasBalance && row.installments?.length > 0 && <div className="statement-installments">
            <span className="admin-course-field-label">Installment schedule</span>
            <ul>{row.installments.map((installment, index) => <li key={index}><span>{installment.label}</span><span>{peso(installment.amount)} due {formatDate(installment.dueDate)}</span></li>)}</ul>
          </div>}
          {row.paidAt && <small className="statement-paid-note">Last payment on {formatDate(row.paidAt)}</small>}
          {hasBalance && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, paddingTop: 14, borderTop: '1px solid #edf0ec' }}>
              <button
                type="button"
                className="button button-primary button-compact"
                onClick={() => setPayingRow(row)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <CreditCard size={14} /> Pay remaining balance ({peso(row.balance)})
              </button>
            </div>
          )}
        </article>
      })}
    </div>

    {payingRow && (
      <PayBalanceModal
        key={payingRow.id}
        row={payingRow}
        onClose={() => setPayingRow(null)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['my-billing'] })
        }}
      />
    )}
  </>
}
