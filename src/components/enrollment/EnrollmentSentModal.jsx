import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { CircleCheck, Mail, X } from 'lucide-react'

// Confirmation modal shown once the applicant finishes payment: the enrollment record is
// with the academy and the account-setup email is on its way. Not a payment receipt — the
// verified PayMongo webhook is what actually advances the enrollment server-side.
export default function EnrollmentSentModal({ open, email, onClose }) {
  const closeRef = useRef(null)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (event) => { if (event.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return <div className="enrollment-sent-backdrop" role="dialog" aria-modal="true" aria-labelledby="enrollment-sent-title" onClick={onClose}>
    <div className="enrollment-sent-modal" onClick={(event) => event.stopPropagation()}>
      <button type="button" ref={closeRef} className="enrollment-sent-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
      <span className="enrollment-sent-badge"><CircleCheck size={30} /></span>
      <p className="eyebrow">ENROLLMENT SUBMITTED</p>
      <h2 id="enrollment-sent-title">Your enrollment has<br /><em>been sent.</em></h2>
      <p className="enrollment-sent-lead">We’ve received your enrollment and PayMongo is confirming your payment securely. Once it’s verified, an account-setup email with your sign-in credentials will be sent{email ? <> to <strong>{email}</strong></> : ' to your enrollment email'}.</p>
      <div className="enrollment-sent-note"><Mail size={17} /><p>Check your inbox (and spam folder) for further instructions. Approval by the academy can take a short while.</p></div>
      <div className="enrollment-sent-actions"><Link className="button button-primary" to="/auth?state=pending">Go to sign-in</Link><Link className="button button-ghost" to="/">Return to Tree Academy</Link></div>
    </div>
  </div>
}
