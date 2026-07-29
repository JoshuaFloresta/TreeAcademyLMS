import { useState } from 'react'
import { Clock3, ShieldCheck } from 'lucide-react'
import PrimaryButton from '../PrimaryButton.jsx'

const peso = (amount) => `₱${Number(amount ?? 14900).toLocaleString('en-PH')}`

// TODO(remove before launch): the "test" plan is a temporary ₱1 checkout option for exercising the
// real PayMongo checkout → webhook → auto-provisioning path without charging the real price.
// Remove the option below and its handling in server/index.js's payment-session route once done.
export default function PaymentStep({ amount, currency = 'PHP', upfrontAmount, onPay, message, onBack, loading }) {
  const [plan, setPlan] = useState('full')
  // Only offer the upfront choice once the fee has loaded and is actually less than the full
  // price — otherwise there's nothing meaningful to choose between.
  const canPayUpfront = Number.isFinite(upfrontAmount) && upfrontAmount > 0 && upfrontAmount < Number(amount)
  const chargeNow = plan === 'test' ? 1 : plan === 'upfront' && canPayUpfront ? upfrontAmount : amount
  const submitPlan = () => onPay(plan === 'test' ? 'test' : (canPayUpfront && plan === 'upfront' ? 'upfront' : 'full'))

  return <>
    <p className="eyebrow">STEP 4 OF 4 · SECURE PAYMENT</p>
    <h1>Your enrollment is<br /><em>ready for payment.</em></h1>
    <p className="lead">Your three signed PDFs have been added to the enrollment record and sent to the academy. Continue to secure PayMongo checkout to activate your LMS account.</p>

    <div className="payment-plan-options" role="radiogroup" aria-label="Payment option">
      <label className={`payment-plan-option ${plan === 'full' ? 'active' : ''}`}>
        <input type="radio" name="payment-plan" value="full" checked={plan === 'full'} onChange={() => setPlan('full')} />
        <span><strong>Pay in full</strong><small>Settle the entire enrollment fee now.</small></span>
        <b>{peso(amount)}</b>
      </label>
      {canPayUpfront && <label className={`payment-plan-option ${plan === 'upfront' ? 'active' : ''}`}>
        <input type="radio" name="payment-plan" value="upfront" checked={plan === 'upfront'} onChange={() => setPlan('upfront')} />
        <span><strong>Pay upfront fee only</strong><small>Reserve your slot now; the academy will follow up for the remaining {peso(amount - upfrontAmount)}.</small></span>
        <b>{peso(upfrontAmount)}</b>
      </label>}
      <label className={`payment-plan-option ${plan === 'test' ? 'active' : ''}`}>
        <input type="radio" name="payment-plan" value="test" checked={plan === 'test'} onChange={() => setPlan('test')} />
        <span><strong>Test payment (temporary)</strong><small>For staff testing only — real PayMongo checkout for ₱1.</small></span>
        <b>{peso(1)}</b>
      </label>
    </div>

    <div className="payment-card"><div><span className="payment-lock"><ShieldCheck size={17} /></span><div><strong>Tree Academy All-Access</strong><small>{plan === 'test' ? 'Test charge' : plan === 'upfront' && canPayUpfront ? 'Upfront reservation fee' : 'One-time enrollment'} · {currency}</small></div></div><strong className="payment-amount">{peso(chargeNow)}</strong></div>
    <div className="payment-methods"><span>Secure checkout by</span><strong>PayMongo</strong><i>GCash</i><i>Maya</i><i>VISA</i></div>
    {message && <div className="payment-message"><Clock3 size={18} /><p>{message}</p></div>}
    <div className="button-row"><button type="button" className="button button-ghost" onClick={onBack} disabled={loading}>Back</button><PrimaryButton type="button" onClick={submitPlan} disabled={loading}>{loading ? 'Opening checkout…' : 'Proceed to payment'}</PrimaryButton></div>
  </>
}
