import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CircleCheck, ShieldCheck, X } from 'lucide-react'
import Brand from '../components/Brand.jsx'
import ApplicationStep from '../components/enrollment/ApplicationStep.jsx'
import DocumentStep from '../components/enrollment/DocumentStep.jsx'
import PaymentStep from '../components/enrollment/PaymentStep.jsx'
import EnrollmentAside from '../components/enrollment/EnrollmentAside.jsx'
import EnrollmentSentModal from '../components/enrollment/EnrollmentSentModal.jsx'
import { API_URL, fetchPricing } from '../lib/api.js'
import { pathways } from '../lib/academyData.js'

async function responseData(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? 'We could not save this step. Please try again.')
  return data
}

// Dev-only: DevToolbar's enrollment shortcuts stash a fast-forwarded enrollment here so this
// page can open straight into contract signing or payment instead of step 1.
function readDevBootstrap() {
  if (!import.meta.env.DEV) return null
  try {
    const raw = sessionStorage.getItem('treeacademy_dev_bootstrap')
    if (!raw) return null
    sessionStorage.removeItem('treeacademy_dev_bootstrap')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export default function EnrollmentPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const paymentState = params.get('payment')
  const [devBootstrap] = useState(readDevBootstrap)
  const [step, setStep] = useState(paymentState ? 4 : (devBootstrap?.step ?? 1))
  const [application, setApplication] = useState(() => devBootstrap ? { id: devBootstrap.id, name: devBootstrap.name, email: devBootstrap.email, phone: devBootstrap.phone, amount: devBootstrap.amount, currency: devBootstrap.currency } : null)
  const [intake, setIntake] = useState(() => devBootstrap?.intake ?? null)
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
  const upfrontKeyByPathway = { broker: 'upfrontBroker', consultant: 'upfrontConsultant', agent: 'upfrontAgent' }
  const upfrontAmount = pricing ? pricing[upfrontKeyByPathway[pathway.id]] : null

  useEffect(() => {
    let cancelled = false
    fetchPricing().then((data) => { if (!cancelled) setPricing(data) }).catch(() => {})
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

  const launchPayment = async (plan) => {
    setBusy(true); setPaymentMessage('')
    try {
      const result = await responseData(await fetch(`${API_URL}/api/enrollments/${application.id}/payment-session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) }))
      if (result.mode === 'payment_link_fallback') setPaymentMessage(result.message)
      window.location.assign(result.checkoutUrl)
    } catch (error) { setPaymentMessage(error.message); setBusy(false) }
  }

  if (paymentState) return <div className="enrollment-page"><header className="enrollment-header"><Brand /><Link to="/" className="close-enrollment"><X size={19} /> Exit</Link></header><main className="enrollment-main payment-return"><CircleCheck size={42} /><p className="eyebrow">PAYMENT {paymentState === 'success' ? 'RETURN RECEIVED' : 'CANCELLED'}</p><h1>{paymentState === 'success' ? <>Thank you for<br /><em>your enrollment.</em></> : <>Your payment is<br /><em>not complete yet.</em></>}</h1><p className="lead">{paymentState === 'success' ? 'PayMongo is confirming your payment securely. Once the verified payment webhook is received, an account-setup email will be sent to your enrollment email address.' : 'No payment was recorded. You can return to the enrollment flow and open checkout again when you are ready.'}</p><Link className="button button-primary" to={paymentState === 'success' ? '/' : '/enroll'}>{paymentState === 'success' ? 'Return to Tree Academy' : 'Return to enrollment'}</Link></main><EnrollmentSentModal open={sentOpen} email={returnEmail} onClose={() => setSentOpen(false)} /></div>

  const activeProgress = step >= 4 ? 4 : step
  const content = step === 1 ? <ApplicationStep pathway={pathway} applicant={application} onSubmit={submitApplication} onBack={() => navigate('/')} submitting={busy} error={formError} />
    : step === 2 ? <DocumentStep enrollmentId={application?.id} type={documentType} applicant={application} application={intake} onSubmit={(payload) => submitDocument(documentType, payload)} onBack={() => setStep(1)} submitting={busy} error={formError} />
      : step === 3 ? <PaymentStep amount={application?.amount} currency={application?.currency} upfrontAmount={upfrontAmount} onPay={launchPayment} message={paymentMessage} onBack={() => setStep(2)} loading={busy} />
        : <div className="enrollment-fallback"><h2>Something went wrong.</h2><p>Your enrollment session is not available right now. Please refresh or return home to try again.</p><button type="button" className="button button-ghost" onClick={() => navigate('/enroll')}>Restart enrollment</button></div>

  return <div className="enrollment-page"><header className="enrollment-header"><Brand /><div className="secure-note"><ShieldCheck size={16} /> Secure enrollment</div><Link to="/" className="close-enrollment"><X size={19} /> Exit</Link></header><main className="enrollment-main"><div className="enrollment-progress enrollment-progress-four"><span className={activeProgress >= 1 ? 'active' : ''}>1 <small>Admission</small></span><i /><span className={activeProgress >= 2 ? 'active' : ''}>2 <small>Agreement</small></span><i /><span className={activeProgress >= 3 ? 'active' : ''}>3 <small>Payment</small></span><i /><span className={activeProgress >= 4 ? 'active' : ''}>4 <small>Complete</small></span></div><div className={step <= 2 ? 'enrollment-layout full-width' : 'enrollment-layout'}><section className="enrollment-content">{content}</section>{step > 2 && <EnrollmentAside pathway={pathway} />}</div></main><EnrollmentSentModal open={sentOpen} email={application?.email} onClose={() => setSentOpen(false)} /></div>
}
