import { useState } from 'react'
import { Tag, X } from 'lucide-react'

// The discount code input on the payment step. Deliberately holds no price logic of its own — it
// applies/removes the code and the parent re-renders from the enrollment the server returns, so
// what is displayed can never disagree with what will be charged.
export default function VoucherField({ discount, onApply, onRemove, disabled }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (action) => {
    setBusy(true); setError('')
    try { await action() } catch (problem) { setError(problem.message) } finally { setBusy(false) }
  }
  const apply = (event) => {
    event.preventDefault()
    const trimmed = code.trim()
    if (!trimmed) return setError('Enter a voucher code.')
    run(async () => { await onApply(trimmed); setCode('') })
  }

  if (discount) return <div className="voucher-applied">
    <span className="voucher-applied-code"><Tag size={14} /> {discount.code}</span>
    <span className="voucher-applied-note">{discount.discountType === 'percent' ? `${discount.discountValue}% off` : 'Discount'} applied</span>
    <button type="button" className="voucher-remove" onClick={() => run(onRemove)} disabled={busy || disabled} aria-label={`Remove voucher ${discount.code}`}><X size={14} /></button>
    {error && <p className="voucher-error" role="alert">{error}</p>}
  </div>

  return <form className="voucher-field" onSubmit={apply}>
    <label htmlFor="voucher-code">Have a voucher code?</label>
    <div className="voucher-row">
      {/* Uppercased on the way in to match how the code is stored and displayed — the server
          normalises too, so this is presentation only, not the validation. */}
      <input id="voucher-code" value={code} onChange={(event) => { setCode(event.target.value.toUpperCase()); setError('') }} placeholder="Enter code" autoComplete="off" spellCheck="false" maxLength={40} disabled={busy || disabled} />
      <button type="submit" className="button button-ghost button-compact" disabled={busy || disabled || !code.trim()}>{busy ? 'Checking…' : 'Apply'}</button>
    </div>
    {error && <p className="voucher-error" role="alert">{error}</p>}
  </form>
}
