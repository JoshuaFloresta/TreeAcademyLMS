import { useQuery } from '@tanstack/react-query'
import { CalendarClock, Receipt } from 'lucide-react'
import { fetchMyBilling } from '../../lib/lms.js'
import StatusPill from '../../components/StatusPill.jsx'
import Loading from '../../components/Loading.jsx'

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

// A learner's own billing history — every enrollment tied to their email, with the fee, what
// they've actually paid, and (for a "pay upfront only" plan) the remaining balance and any due
// date/note staff set on it. Read-only: this app collects payment through PayMongo checkout only,
// there's no "pay the rest" action here.
export default function StatementOfAccountPage() {
  const { data: statements = [], isLoading, error } = useQuery({ queryKey: ['my-billing'], queryFn: fetchMyBilling })

  return <>
    <div className="page-title-row"><div><p className="eyebrow">YOUR ACCOUNT</p><h1>Statement of Account</h1><p>Your enrollment fee, what you’ve paid, and anything still outstanding.</p></div></div>
    {isLoading && <Loading block label="Loading your statement…" />}
    {error && <div className="empty-state"><Receipt size={26} /><strong>Could not load your statement</strong><p>{error.message}</p></div>}
    {!isLoading && !error && !statements.length && <div className="empty-state"><Receipt size={26} /><strong>Nothing here yet</strong><p>Once you start an enrollment, its billing details will show up here.</p></div>}
    <div className="statement-list">
      {statements.map((row) => {
        const meta = statusMeta[row.status] ?? { label: row.status, kind: 'gold' }
        return <article className="statement-card" key={row.id}>
          <div className="statement-card-head">
            <div><h2>{row.pathwayTitle}</h2><small>{paymentSummary(row)}</small></div>
            <StatusPill kind={meta.kind}>{meta.label}</StatusPill>
          </div>
          <div className="statement-figures">
            <div><span>Full enrollment price</span><strong>{peso(row.amount)}</strong></div>
            <div><span>Amount paid</span><strong>{peso(row.amountPaid)}</strong></div>
            <div><span>Balance remaining</span><strong className={row.balance > 0 ? 'statement-balance-due' : ''}>{peso(row.balance)}</strong></div>
          </div>
          {row.balance > 0 && row.balanceDueDate && <p className="statement-due-note"><CalendarClock size={15} /> Please settle by <strong>{formatDate(row.balanceDueDate)}</strong>{row.balanceNote ? ` — ${row.balanceNote}` : ''}</p>}
          {row.paidAt && <small className="statement-paid-note">Last payment on {formatDate(row.paidAt)}</small>}
        </article>
      })}
    </div>
  </>
}
