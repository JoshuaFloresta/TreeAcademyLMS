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

  // Quick preset shortcuts for partial payments
  const presets = [
    { label: '₱1,000', val: 1000 },
    { label: '₱2,500', val: 2500 },
    { label: '₱5,000', val: 5000 },
    { label: '50% Balance', val: Math.round(balance / 2) },
  ].filter((p) => p.val < balance && p.val >= minAmount)

  return (
    <Modal open={Boolean(row)} onClose={onClose} labelledBy="pay-balance-title" className="confirm-modal">
      <p className="eyebrow">ONLINE PAYMENT</p>
      <h2 id="pay-balance-title">Pay Remaining Balance</h2>
      <p className="enrollment-sent-lead" style={{ margin: '4px 0 16px', color: '#556357' }}>
        {row?.pathwayTitle} {row?.batch && <span style={{ fontWeight: 600 }}>({row.batch})</span>}
      </p>

      {/* Financial Summary Card */}
      <div style={{
        background: '#f6f8f6',
        border: '1px solid #e1e7e1',
        borderRadius: 8,
        padding: '14px 16px',
        marginBottom: 18,
        fontSize: 13,
        textAlign: 'left',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: '#657367' }}>Total course fee</span>
          <strong>{peso(row?.amount)}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: '#657367' }}>Amount already paid</span>
          <span style={{ color: '#1b432e', fontWeight: 600 }}>
            {peso(row?.amountPaid)} <small style={{ color: '#23633a', background: '#e5f3e7', padding: '1px 6px', borderRadius: 4, fontSize: 10, marginLeft: 4 }}>PAID</small>
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #dde3dc', paddingTop: 8, marginTop: 2 }}>
          <span style={{ fontWeight: 700, color: '#1b432e' }}>Remaining balance</span>
          <strong style={{ color: '#a83f32', fontSize: 16 }}>{peso(balance)}</strong>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ textAlign: 'left' }}>
        {/* Payment Mode Selection Cards */}
        <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
          {/* Option 1: Full Balance */}
          <div
            onClick={() => setPayType('full')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') setPayType('full') }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              borderRadius: 8,
              border: payType === 'full' ? '2px solid #1b432e' : '1px solid #d4ded4',
              background: payType === 'full' ? '#f2f7f2' : '#ffffff',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              boxShadow: payType === 'full' ? '0 1px 4px rgba(27,67,46,0.08)' : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                border: payType === 'full' ? '5px solid #1b432e' : '2px solid #aeb8ae',
                background: '#ffffff',
                display: 'inline-block',
                flexShrink: 0,
                boxSizing: 'border-box',
                transition: 'border 0.15s ease',
              }} />
              <div>
                <strong style={{ display: 'block', fontSize: 13, color: '#1b432e' }}>Pay Full Balance</strong>
                <small style={{ color: '#657367', fontSize: 11 }}>Settle all remaining tuition</small>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <strong style={{ fontSize: 15, color: '#1b432e', display: 'block' }}>{peso(balance)}</strong>
              <small style={{ fontSize: 10, fontWeight: 700, color: '#b39255', textTransform: 'uppercase', letterSpacing: 0.5 }}>Recommended</small>
            </div>
          </div>

          {/* Option 2: Partial Amount */}
          <div
            onClick={() => setPayType('custom')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') setPayType('custom') }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              borderRadius: 8,
              border: payType === 'custom' ? '2px solid #1b432e' : '1px solid #d4ded4',
              background: payType === 'custom' ? '#f2f7f2' : '#ffffff',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              boxShadow: payType === 'custom' ? '0 1px 4px rgba(27,67,46,0.08)' : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                border: payType === 'custom' ? '5px solid #1b432e' : '2px solid #aeb8ae',
                background: '#ffffff',
                display: 'inline-block',
                flexShrink: 0,
                boxSizing: 'border-box',
                transition: 'border 0.15s ease',
              }} />
              <div>
                <strong style={{ display: 'block', fontSize: 13, color: '#1b432e' }}>Pay Partial Amount</strong>
                <small style={{ color: '#657367', fontSize: 11 }}>Choose an installment or custom amount</small>
              </div>
            </div>
            <span style={{ fontSize: 11, background: '#eaf0ea', color: '#1b432e', padding: '3px 8px', borderRadius: 4, fontWeight: 600 }}>
              Flexible
            </span>
          </div>
        </div>

        {/* Custom Amount Sub-form */}
        {payType === 'custom' && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #e1e7e1',
            borderRadius: 8,
            padding: '12px 14px',
            marginBottom: 16,
          }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334035', marginBottom: 6 }}>
              Enter payment amount (₱)
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span style={{
                position: 'absolute',
                left: 12,
                fontWeight: 700,
                color: '#657367',
                fontSize: 14,
                pointerEvents: 'none',
              }}>₱</span>
              <input
                type="number"
                min={minAmount}
                max={balance}
                step={1}
                required
                autoFocus
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                placeholder={`Min ${minAmount}, up to ${balance}`}
                style={{
                  width: '100%',
                  paddingLeft: 28,
                  paddingRight: 12,
                  height: 40,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#1b432e',
                  border: '1px solid #cdd7cc',
                  borderRadius: 6,
                  outlineColor: '#b39255',
                }}
              />
            </div>

            {presets.length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#657367' }}>Quick select:</span>
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setCustomAmount(String(preset.val))}
                    style={{
                      border: Number(customAmount) === preset.val ? '1px solid #1b432e' : '1px solid #d4ded4',
                      background: Number(customAmount) === preset.val ? '#1b432e' : '#ffffff',
                      color: Number(customAmount) === preset.val ? '#ffffff' : '#334035',
                      borderRadius: 4,
                      padding: '3px 8px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}

            <small style={{ color: '#657367', fontSize: 11, display: 'block', marginTop: 8 }}>
              Accepted range: ₱{minAmount.toLocaleString('en-PH')} to {peso(balance)}.
            </small>
          </div>
        )}

        {/* Trust & PayMongo Channel Banner */}
        <div style={{
          background: '#fcfbf7',
          border: '1px solid #ece8db',
          borderRadius: 8,
          padding: '10px 14px',
          marginBottom: 18,
          fontSize: 12,
          color: '#524b3c',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <ShieldCheck size={20} style={{ color: '#2d6a4f', flexShrink: 0 }} />
          <div style={{ lineHeight: 1.4 }}>
            <strong style={{ display: 'block', color: '#1b432e', fontSize: 12 }}>PayMongo Secure Payment Gateway</strong>
            <span style={{ color: '#6e685a', fontSize: 11 }}>Accepts GCash, Maya, QR Ph, &amp; Credit/Debit cards with instant confirmation.</span>
          </div>
        </div>

        {error && <p className="form-alert" role="alert" style={{ marginBottom: 14 }}>{error}</p>}

        <div className="confirm-actions">
          <button type="button" className="button button-ghost" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            type="submit"
            className="button button-primary"
            style={{ minWidth: 160, justifyContent: 'center' }}
            disabled={loading || !isValidAmount}
          >
            <CreditCard size={15} /> {loading ? 'Preparing payment…' : `Pay ${peso(targetAmount)}`}
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
