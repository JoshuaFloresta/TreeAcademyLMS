import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CircleCheck, ShieldCheck, X } from 'lucide-react'
import Brand from '../components/Brand.jsx'
import ApplicationStep from '../components/enrollment/ApplicationStep.jsx'
import DocumentStep from '../components/enrollment/DocumentStep.jsx'
import PaymentStep from '../components/enrollment/PaymentStep.jsx'
import EnrollmentAside from '../components/enrollment/EnrollmentAside.jsx'
import EnrollmentSentModal from '../components/enrollment/EnrollmentSentModal.jsx'
import HelpLauncher from '../components/enrollment/HelpLauncher.jsx'
import { API_URL, applyEnrollmentVoucher, fetchPricing, removeEnrollmentVoucher } from '../lib/api.js'
import { fetchPathwayStats } from '../lib/publicCatalog.js'
import { blockedPathwayMessage, pathways, upfrontKeyByPathway } from '../lib/academyData.js'

async function responseData(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? 'We could not save this step. Please try again.')
  return data
}

export default function EnrollmentPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const paymentState = params.get('payment')
  const [step, setStep] = useState(paymentState ? 4 : 1)
  const [application, setApplication] = useState(null)
  const [intake, setIntake] = useState(null)
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [paymentMessage, setPaymentMessage] = useState('')
  const [sentOpen, setSentOpen] = useState(paymentState === 'success')
  // After a PayMongo redirect the page reloads fresh (no in-memory application), so recover the
  // applicant email the same browser saved during intake to personalize the confirmation modal.
  const [returnEmail] = useState(() => { try { return sessionStorage.getItem('treeacademy_enrollment_email') || '' } catch { return '' } })
  const pathway = pathways.find((item) => item.id === params.get('pathway')) ?? pathways[0]
  const documentType = pathway.id === 'consultant' ? 'reclex' : 'realex-reblex'
  const [pricing, setPricing] = useState(null)
  const upfrontAmount = pricing ? pricing[upfrontKeyByPathway[pathway.id]] : null
  const [pathwayStats, setPathwayStats] = useState({})
  // Catches a direct/bookmarked link to a pathway that's since closed or isn't open yet — the
  // landing page's own modal already blocks the CTA for this case, and the server is the actual
  // gate (POST /api/enrollments rejects it either way), but this avoids sending someone through
  // the whole admission form only to be rejected at the very end.
  const pathwayBlockedMessage = blockedPathwayMessage(pathwayStats[pathway.id])
  // The pathway lives in the URL, so switching it is just a param change — shareable, and the
  // document type, pricing, and blocked-state checks above all re-derive from it automatically.
  // Only offered before the enrollment record exists: once POST /api/enrollments has run, the
  // pathway is committed server-side and the signed agreement is keyed to it.
  const canChangePathway = step === 1 && !application
  const changePathway = (id) => {
    const next = new URLSearchParams(params)
    next.set('pathway', id)
    setParams(next, { replace: true })
  }
  // Closed / not-yet-open pathways are shown but not selectable, so nobody can switch into a dead
  // end where the form is replaced by a blocked notice and there's no selector left to switch back.
  const pathwayOptions = pathways.map((item) => {
    const stats = pathwayStats[item.id]
    const note = !stats ? '' : stats.closed ? ' — enrollment closed'
      : stats.opensLater ? ` — opens ${new Date(stats.availableFrom).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''
    return { id: item.id, title: item.title, note, disabled: Boolean(note) }
  })

  useEffect(() => {
    let cancelled = false
    fetchPricing().then((data) => { if (!cancelled) setPricing(data) }).catch(() => {})
    fetchPathwayStats().then((data) => { if (!cancelled) setPathwayStats(data) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const submitApplication = async ({ data }) => {
    setBusy(true); setFormError('')
    try {
      let activeApplication = application
      if (!activeApplication) {
        const record = await responseData(await fetch(`${API_URL}/api/enrollments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: data.full_name, email: data.email, phone: data.mobile, pathway: pathway.id }) }))
        activeApplication = { id: record.id, name: data.full_name, email: data.email, phone: data.mobile, amount: record.amount, currency: record.currency }
        sessionStorage.setItem('treeacademy_enrollment_id', record.id)
        sessionStorage.setItem('treeacademy_enrollment_email', data.email)
        setApplication(activeApplication)
      }
      await responseData(await fetch(`${API_URL}/api/enrollments/${activeApplication.id}/application`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) }))
      // The application route rewrites applicant name/phone/email from this form every time it runs,
      // so the client copy has to be re-synced or it goes stale as soon as someone goes Back and
      // edits one of them. Step 2 binds its readOnly signature name to this value and the server
      // rejects a mismatch, which left the applicant stuck on an error they had no field to fix.
      setApplication({ ...activeApplication, name: data.full_name, email: data.email, phone: data.mobile })
      sessionStorage.setItem('treeacademy_enrollment_email', data.email)
      setIntake(data)
      setStep(2)
    } catch (error) { setFormError(error.message) } finally { setBusy(false) }
  }

  const submitDocument = async (type, payload) => {
    setBusy(true); setFormError('')
    try {
      await responseData(await fetch(`${API_URL}/api/enrollments/${application.id}/documents/${type}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }))
      setStep(3)
    } catch (error) { setFormError(error.message) } finally { setBusy(false) }
  }

  // Both voucher calls return the updated enrollment, so the displayed amount always comes from the
  // server rather than being recomputed here — the browser never decides what anything costs.
  // Errors are thrown on to VoucherField, which owns the "invalid/expired code" message.
  const applyVoucher = async (code) => {
    const updated = await applyEnrollmentVoucher(application.id, code)
    setApplication((current) => ({ ...current, amount: updated.amount, discount: updated.discount }))
    setPaymentMessage('')
  }
  const removeVoucher = async () => {
    const updated = await removeEnrollmentVoucher(application.id)
    setApplication((current) => ({ ...current, amount: updated.amount, discount: updated.discount }))
  }

  const launchPayment = async (plan) => {
    setBusy(true); setPaymentMessage('')
    try {
      const response = await fetch(`${API_URL}/api/enrollments/${application.id}/payment-session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) })
      // A voucher that expired between being applied and checkout opening is stripped server-side,
      // and the corrected total comes back with the 409 — take it, so the applicant sees the real
      // price alongside the explanation instead of a stale discounted one.
      if (response.status === 409) {
        const conflict = await response.json().catch(() => ({}))
        if (conflict.amount !== undefined) setApplication((current) => ({ ...current, amount: conflict.amount, discount: conflict.discount ?? null }))
        throw new Error(conflict.error ?? 'This enrollment is not ready for payment.')
      }
      const result = await responseData(response)
      if (result.mode === 'payment_link_fallback') setPaymentMessage(result.message)
      window.location.assign(result.checkoutUrl)
    } catch (error) { setPaymentMessage(error.message); setBusy(false) }
  }

  if (paymentState) return <div className="enrollment-page"><header className="enrollment-header"><Brand /><Link to="/" className="close-enrollment"><X size={19} /> Exit</Link></header><main className="enrollment-main payment-return"><CircleCheck size={42} /><p className="eyebrow">PAYMENT {paymentState === 'success' ? 'RETURN RECEIVED' : 'CANCELLED'}</p><h1>{paymentState === 'success' ? <>Thank you for<br /><em>your enrollment.</em></> : <>Your payment is<br /><em>not complete yet.</em></>}</h1><p className="lead">{paymentState === 'success' ? 'PayMongo is confirming your payment securely. Once the verified payment webhook is received, an account-setup email will be sent to your enrollment email address.' : 'No payment was recorded. You can return to the enrollment flow and open checkout again when you are ready.'}</p><Link className="button button-primary" to={paymentState === 'success' ? '/' : '/enroll'}>{paymentState === 'success' ? 'Return to Tree Academy' : 'Return to enrollment'}</Link></main><HelpLauncher step={4} /><EnrollmentSentModal open={sentOpen} email={returnEmail} onClose={() => setSentOpen(false)} /></div>

  const activeProgress = step >= 4 ? 4 : step
  const content = pathwayBlockedMessage && step === 1 && !application
    ? <div className="enrollment-fallback"><h2>This program isn’t open right now.</h2><p>{pathwayBlockedMessage} Please check back once enrollment opens, or explore our other pathways.</p><Link className="button button-primary" to="/">Return home</Link></div>
    : step === 1 ? <ApplicationStep pathway={pathway} applicant={application} saved={intake} onSubmit={submitApplication} onBack={() => navigate('/')} submitting={busy} error={formError} pathwayOptions={pathwayOptions} onPathwayChange={canChangePathway ? changePathway : undefined} />
    : step === 2 ? <DocumentStep enrollmentId={application?.id} type={documentType} applicant={application} application={intake} onSubmit={(payload) => submitDocument(documentType, payload)} onBack={() => setStep(1)} submitting={busy} error={formError} />
      : step === 3 ? <PaymentStep amount={application?.amount} currency={application?.currency} upfrontAmount={upfrontAmount} discount={application?.discount} onApplyVoucher={applyVoucher} onRemoveVoucher={removeVoucher} onPay={launchPayment} message={paymentMessage} onBack={() => setStep(2)} loading={busy} />
        : <div className="enrollment-fallback"><h2>Something went wrong.</h2><p>Your enrollment session is not available right now. Please refresh or return home to try again.</p><button type="button" className="button button-ghost" onClick={() => navigate('/enroll')}>Restart enrollment</button></div>

  return <div className="enrollment-page"><header className="enrollment-header"><Brand /><div className="secure-note"><ShieldCheck size={16} /> Secure enrollment</div><Link to="/" className="close-enrollment"><X size={19} /> Exit</Link></header><main className="enrollment-main"><div className="enrollment-progress enrollment-progress-four"><span className={activeProgress >= 1 ? 'active' : ''}>1 <small>Admission</small></span><i /><span className={activeProgress >= 2 ? 'active' : ''}>2 <small>Agreement</small></span><i /><span className={activeProgress >= 3 ? 'active' : ''}>3 <small>Payment</small></span><i /><span className={activeProgress >= 4 ? 'active' : ''}>4 <small>Complete</small></span></div><div className={step <= 2 ? 'enrollment-layout full-width' : 'enrollment-layout'}><section className="enrollment-content">{content}</section>{step > 2 && <EnrollmentAside pathway={pathway} />}</div></main><HelpLauncher step={step} error={formError || paymentMessage || pathwayBlockedMessage} /><EnrollmentSentModal open={sentOpen} email={application?.email} onClose={() => setSentOpen(false)} /></div>
}
