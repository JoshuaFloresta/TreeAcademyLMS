import { useState } from 'react'
import { Clock3, ShieldCheck } from 'lucide-react'
import PrimaryButton from '../PrimaryButton.jsx'
import VoucherField from './VoucherField.jsx'
import { payInFullDiscountPreview } from '../../lib/academyData.js'

const peso = (amount) => `₱${Number(amount ?? 14900).toLocaleString('en-PH')}`

export default function PaymentStep({ amount, currency = 'PHP', upfrontAmount, pricing, pathwayId, discount, onApplyVoucher, onRemoveVoucher, onPay, message, onBack, loading }) {
  const [plan, setPlan] = useState('full')
  // A voucher either discounts the enrollment total or only the reservation fee due today — the
  // admin decides which per code. `amount` already arrives net of a total-scoped one; an
  // upfront-scoped one leaves it at list price and is subtracted from the fee below instead.
  const cutsUpfront = discount?.appliesTo === 'upfront'
  const cutsTotal = Boolean(discount) && !cutsUpfront
  // Only offer the upfront choice once the fee has loaded and is actually less than the full
  // price — otherwise there's nothing meaningful to choose between. A total discount that drops
  // below the reservation fee correctly leaves "pay in full" as the only option.
  const listUpfront = cutsUpfront ? Number(discount.baseAmount) : Number(upfrontAmount)
  const payableUpfront = cutsUpfront ? Math.max(0, listUpfront - discount.discountAmount) : listUpfront
  const canPayUpfront = Number.isFinite(payableUpfront) && payableUpfront > 0 && payableUpfront < Number(amount)
  // Automatic, no code needed — and mutually exclusive with a voucher (any scope), matching the
  // server's own rule in payment-session: a voucher already reflects whatever deal was agreed.
  const payInFullDiscount = discount ? 0 : payInFullDiscountPreview(pricing, pathwayId, amount)
  const fullChargeAmount = Math.max(0, Number(amount ?? 0) - payInFullDiscount)
  const chargeNow = plan === 'upfront' && canPayUpfront ? payableUpfront : fullChargeAmount
  // Preview of the staff-tracked installment schedule the upfront plan turns into once payment is
  // confirmed — exact amounts/dates are only ever generated server-side (buildInstallmentSchedule),
  // this is just so the applicant knows what to expect before choosing this plan.
  const installmentCount = Math.max(1, Math.trunc(Number(pricing?.installmentCount ?? 1)))
  const installmentIntervalDays = Math.max(1, Math.trunc(Number(pricing?.installmentIntervalDays ?? 30)))
  const remainingBalance = Math.max(0, Number(amount ?? 0) - payableUpfront)
  const perInstallment = remainingBalance / installmentCount
  const submitPlan = () => onPay(canPayUpfront && plan === 'upfront' ? 'upfront' : 'full')

  return <>
    <p className="eyebrow">STEP 4 OF 4 · SECURE PAYMENT</p>
    <h1>Your enrollment is<br /><em>ready for payment.</em></h1>
    <p className="lead">Your three signed PDFs have been added to the enrollment record and sent to the academy. Continue to secure PayMongo checkout to activate your LMS account.</p>

    <div className="payment-plan-options" role="radiogroup" aria-label="Payment option">
      <label className={`payment-plan-option ${plan === 'full' ? 'active' : ''}`}>
        <input type="radio" name="payment-plan" value="full" checked={plan === 'full'} onChange={() => setPlan('full')} />
        <span><strong>Pay in full</strong><small>Settle the entire enrollment fee now.{payInFullDiscount > 0 && ` You save ${peso(payInFullDiscount)} automatically for paying in full.`}</small></span>
        {/* The struck-through price appears on whichever option actually reduces it — a voucher, or
            the automatic pay-in-full discount — so the saving is never shown against a figure it
            doesn't change. The two never both apply (see payInFullDiscount above). */}
        <b>{(cutsTotal || payInFullDiscount > 0) && <s>{peso(cutsTotal ? discount.listAmount : amount)}</s>}{peso(cutsTotal ? amount : fullChargeAmount)}</b>
      </label>
      {canPayUpfront && <label className={`payment-plan-option ${plan === 'upfront' ? 'active' : ''}`}>
        <input type="radio" name="payment-plan" value="upfront" checked={plan === 'upfront'} onChange={() => setPlan('upfront')} />
        <span><strong>Pay upfront fee only</strong><small>Reserve your slot now — the remaining {peso(remainingBalance)} is split into {installmentCount} installment{installmentCount === 1 ? '' : 's'} of about {peso(perInstallment)}, due every {installmentIntervalDays} days.</small></span>
        <b>{cutsUpfront && <s>{peso(listUpfront)}</s>}{peso(payableUpfront)}</b>
      </label>}
    </div>

    <VoucherField discount={discount} onApply={onApplyVoucher} onRemove={onRemoveVoucher} disabled={loading} />

    {/* Each scope has a consequence the applicant would otherwise only discover later — a total
        discount doesn't shrink today's reservation fee, and an upfront discount doesn't shrink what
        they owe overall. Both are stated here rather than left to the balance invoice. */}
    {cutsTotal && <div className="voucher-summary">
      <span>Enrollment fee<b>{peso(discount.listAmount)}</b></span>
      <span className="voucher-summary-off">Voucher {discount.code}<b>−{peso(discount.discountAmount)}</b></span>
      <span className="voucher-summary-total">Total after discount<b>{peso(amount)}</b></span>
      {plan === 'upfront' && canPayUpfront && <small>Your discount applies to the enrollment total — it comes off the remaining balance, not the reservation fee.</small>}
    </div>}
    {cutsUpfront && <div className="voucher-summary">
      <span>Reservation fee due today<b>{peso(listUpfront)}</b></span>
      <span className="voucher-summary-off">Voucher {discount.code}<b>−{peso(discount.discountAmount)}</b></span>
      <span className="voucher-summary-total">Pay today<b>{peso(payableUpfront)}</b></span>
      <small>{plan === 'upfront'
        ? `This voucher lowers only the amount due today. Your enrollment total stays ${peso(discount.listAmount)}, so the remaining balance is ${peso(amount - payableUpfront)}.`
        : `This voucher only applies to the reservation fee — choose “Pay upfront fee only” above to use it. Paying in full is ${peso(amount)}.`}</small>
    </div>}
    {payInFullDiscount > 0 && <div className="voucher-summary">
      <span>Enrollment fee<b>{peso(amount)}</b></span>
      <span className="voucher-summary-off">Pay-in-full discount<b>−{peso(payInFullDiscount)}</b></span>
      <span className="voucher-summary-total">Total if paid in full today<b>{peso(fullChargeAmount)}</b></span>
      {plan === 'upfront' && canPayUpfront && <small>This discount only applies when you pay in full today — choose “Pay in full” above to use it.</small>}
    </div>}

    <div className="payment-card"><div><span className="payment-lock"><ShieldCheck size={17} /></span><div><strong>Tree Academy All-Access</strong><small>{plan === 'upfront' && canPayUpfront ? 'Upfront reservation fee' : 'One-time enrollment'} · {currency}</small></div></div><strong className="payment-amount">{peso(chargeNow)}</strong></div>
    <div className="payment-methods"><span>Secure checkout by</span><strong>PayMongo</strong><i>GCash</i><i>Maya</i><i>VISA</i></div>
    {message && <div className="payment-message"><Clock3 size={18} /><p>{message}</p></div>}
    <div className="button-row"><button type="button" className="button button-ghost" onClick={onBack} disabled={loading}>Back</button><PrimaryButton type="button" onClick={submitPlan} disabled={loading}>{loading ? 'Opening checkout…' : 'Proceed to payment'}</PrimaryButton></div>
  </>
}
