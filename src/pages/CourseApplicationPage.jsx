import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CircleCheck, ShieldCheck, X } from 'lucide-react'
import Brand from '../components/Brand.jsx'
import PrimaryButton from '../components/PrimaryButton.jsx'
import GenericDocumentStep from '../components/enrollment/GenericDocumentStep.jsx'
import { fetchCourseAgreement, submitCourseAgreement } from '../lib/api.js'

function Field({ label, children }) { return <label className="application-field"><span>{label}</span>{children}</label> }
const required = (label) => <>{label} <i aria-hidden="true">*</i></>

function ContactStep({ course, applicant, onSubmit }) {
  const [values, setValues] = useState(applicant)
  const submit = (event) => {
    event.preventDefault()
    if (!event.currentTarget.reportValidity()) return
    onSubmit(values)
  }
  return <>
    <p className="eyebrow">STEP 1 OF 2 · YOUR DETAILS</p>
    <h1>Apply for<br /><em>{course.title}.</em></h1>
    <p className="lead">Enter your contact details, then review and sign the course agreement on the next step.</p>
    <form className="application-form" onSubmit={submit} noValidate>
      <div className="application-grid">
        <Field label={required('Full legal name')}><input value={values.name} onChange={(event) => setValues((v) => ({ ...v, name: event.target.value }))} required minLength={2} maxLength={100} /></Field>
        <Field label={required('Email address')}><input type="email" value={values.email} onChange={(event) => setValues((v) => ({ ...v, email: event.target.value }))} required /></Field>
        <Field label="Mobile number"><input value={values.phone} onChange={(event) => setValues((v) => ({ ...v, phone: event.target.value }))} /></Field>
      </div>
      <div className="button-row"><Link className="button button-ghost" to="/">Cancel</Link><PrimaryButton type="submit">Continue</PrimaryButton></div>
    </form>
  </>
}

// The generic, no-payment counterpart to EnrollmentPage.jsx — for a course outside the 3 fixed
// pathways that carries its own admin-uploaded agreement PDF (Course.agreementTemplate). Two steps
// only, held in local state rather than persisted server-side between them, since (unlike the
// pathway flow) there is no payment redirect that could interrupt the session.
export default function CourseApplicationPage() {
  const { slug } = useParams()
  const [course, setCourse] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [step, setStep] = useState(1)
  const [applicant, setApplicant] = useState({ name: '', email: '', phone: '' })
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchCourseAgreement(slug).then((data) => { if (!cancelled) setCourse(data) }).catch((error) => { if (!cancelled) setLoadError(error.message) })
    return () => { cancelled = true }
  }, [slug])

  const submitDocument = async (payload) => {
    setBusy(true); setFormError('')
    try {
      await submitCourseAgreement(slug, { ...applicant, ...payload })
      setStep(3)
    } catch (error) { setFormError(error.message) } finally { setBusy(false) }
  }

  const header = <header className="enrollment-header"><Brand /><div className="secure-note"><ShieldCheck size={16} /> Secure application</div><Link to="/" className="close-enrollment"><X size={19} /> Exit</Link></header>

  if (loadError) return <div className="enrollment-page">{header}<main className="enrollment-main"><div className="enrollment-fallback"><h2>Applications aren't open right now.</h2><p>{loadError}</p><Link className="button button-ghost" to="/">Return home</Link></div></main></div>

  if (!course) return <div className="enrollment-page">{header}<main className="enrollment-main" /></div>

  if (step === 3) return <div className="enrollment-page">{header}<main className="enrollment-main payment-return"><CircleCheck size={42} /><p className="eyebrow">APPLICATION SUBMITTED</p><h1>Thank you for<br /><em>applying.</em></h1><p className="lead">We've saved your signed agreement for {course.title}. If this is your first time enrolling, an account-setup email is on its way to <strong>{applicant.email}</strong> — check your inbox (and spam folder).</p><Link className="button button-primary" to="/auth?state=pending">Go to sign-in</Link></main></div>

  return <div className="enrollment-page">
    {header}
    <main className="enrollment-main">
      <div className="enrollment-progress"><span className={step >= 1 ? 'active' : ''}>1 <small>Your details</small></span><i /><span className={step >= 2 ? 'active' : ''}>2 <small>Agreement</small></span></div>
      <div className="enrollment-layout full-width"><section className="enrollment-content">
        {step === 1
          ? <ContactStep course={course} applicant={applicant} onSubmit={(values) => { setApplicant(values); setFormError(''); setStep(2) }} />
          : <GenericDocumentStep courseSlug={slug} schema={course.fields} applicant={applicant} onSubmit={submitDocument} onBack={() => setStep(1)} submitting={busy} error={formError} />}
      </section></div>
    </main>
  </div>
}
