import { useState } from 'react'
import { Check, FileText } from 'lucide-react'
import PrimaryButton from '../PrimaryButton.jsx'

function Field({ label, children, full = false }) {
  return <label className={full ? 'application-field full' : 'application-field'}><span>{label}</span>{children}</label>
}

function Required({ children }) { return <>{children} <i aria-hidden="true">*</i></> }

const fieldLabels = {
  full_name: 'Full legal name',
  preferred_name: 'Preferred name',
  birth_date: 'Date of birth',
  mobile: 'Mobile number',
  email: 'Email address',
  facebook: 'Facebook / Messenger profile',
  address: 'Complete address',
  occupation: 'Current occupation',
  employer: 'Employer or business',
  emergency_name: 'Emergency contact person',
  emergency_mobile: 'Emergency contact number',
  school: 'School / university',
  degree: 'Degree completed',
  grad_year: 'Year graduated',
  exam_schedule: 'Intended REBLEX schedule',
  attempts: 'Previous REBLEX attempts',
  prc_status: 'PRC application status',
  doc_valid_id: 'Valid government-issued identification',
  doc_diploma: 'Diploma or certificate of graduation',
  doc_tor: 'Transcript of Records',
  strong_topics: 'Strongest subject or topic',
  weak_topics: 'Weakest subject or topic',
  computation_level: 'Comfort with computations',
  situational_level: 'Comfort with long situational questions',
  study_hours: 'Realistic weekly study time',
  internet: 'Internet access',
  device: 'Primary device',
  calculator: 'Calculator familiarity',
  constraints: 'Circumstances affecting attendance or study',
  support_expected: 'Support expected from PASS-FIRST',
  commit_attend: 'Attendance commitment',
  commit_study: 'Study commitment',
  commit_assess: 'Assessment commitment',
  commit_remediate: 'Remediation commitment',
  commit_communicate: 'Communication commitment',
  agree_nonsharing: 'Non-sharing commitment',
  agree_integrity: 'Integrity commitment',
  agree_privacy: 'Privacy consent',
  agree_recording: 'Recording consent',
}

export default function ApplicationStep({ pathway, applicant, onSubmit, onBack, submitting, error }) {
  const [localError, setLocalError] = useState('')
  const learner = applicant ?? {}
  const submit = (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const invalidFields = []

    form.querySelectorAll('[required]').forEach((field) => {
      if (!field.checkValidity()) {
        const label = fieldLabels[field.name] || field.name
        if (!invalidFields.includes(label)) invalidFields.push(label)
      }
    })

    if (invalidFields.length) {
      setLocalError(`Please complete the following required field${invalidFields.length > 1 ? 's' : ''}: ${invalidFields.join(', ')}.`)
      const firstInvalid = form.querySelector('[required]:invalid')
      firstInvalid?.focus()
      return
    }

    const data = Object.fromEntries(new FormData(form))
    form.querySelectorAll('input[type="checkbox"]').forEach((input) => { data[input.name] = input.checked })
    setLocalError('')
    onSubmit({ data })
  }
  const required = <span className="required-mark">*</span>

  return <><p className="eyebrow" >STEP 1 OF 4 · ADMISSION FORM</p><h1>TREE ACADEMY • PASS-FIRST<br /> REVIEW PROGRAM <br/> <em>Application and Enrollment Form</em></h1><p className="lead">Complete your details below. Required fields are marked {required}.</p><div className="application-pathway"><strong>Selected pathway:</strong> {pathway.title}</div><form className="application-form" onSubmit={submit} noValidate><input type="hidden" name="selected_pathway" value={pathway.id} /><section className="application-section"><div className="application-section-head"><FileText size={18} /><div><h2>A. Applicant information</h2><p>Use your complete legal name as shown on official records.</p></div></div><div className="application-grid"><Field label={<Required>Full legal name</Required>}><input name="full_name" defaultValue={learner.name} placeholder="Juan Dela Cruz" required /></Field><Field label="Preferred name"><input name="preferred_name" placeholder="Juan" /></Field><Field label={<Required>Date of birth</Required>}><input type="date" name="birth_date" required /></Field><Field label={<Required>Mobile number</Required>}><input type="tel" name="mobile" defaultValue={learner.phone} placeholder="+63 917 123 4567" required /></Field><Field label={<Required>Email address</Required>}><input type="email" name="email" defaultValue={learner.email} placeholder="tree@example.com" required /></Field><Field label="Facebook / Messenger profile"><input type="url" name="facebook" placeholder="https://facebook.com/josh123" /></Field><Field label={<Required>Complete address</Required>} full><textarea name="address" placeholder="123 Mabini St., Makati City" required /></Field><Field label="Current occupation"><input name="occupation" placeholder="Real estate consultant" /></Field><Field label="Employer or business"><input name="employer" placeholder="ABC Realty Services" /></Field><Field label={<Required>Emergency contact person</Required>}><input name="emergency_name" placeholder="Maria Dela Cruz" required /></Field><Field label={<Required>Emergency contact number</Required>}><input type="tel" name="emergency_mobile" placeholder="+63 917 765 4321" required /></Field></div></section>

    <section className="application-section"><div className="application-section-head"><div><h2>B. Educational and REBLEX eligibility profile</h2><p>For preliminary screening only; PRC requirements remain the applicant’s responsibility.</p></div></div><div className="application-grid"><Field label={<Required>School / university</Required>}><input name="school" placeholder="University of the Philippines" required /></Field><Field label={<Required>Degree completed</Required>}><input name="degree" placeholder="Bachelor of Science " required /></Field><Field label={<Required>Year graduated</Required>}><input type="number" name="grad_year" min="1950" max="2035" placeholder="2023" required /></Field><Field label="Intended REBLEX schedule"><input name="exam_schedule" defaultValue="2027 First Batch" placeholder="2027 First Batch" /></Field><Field label={<Required>Previous REBLEX attempts</Required>}><select name="attempts" required defaultValue=""><option value="" disabled>Select</option><option>None — first taker</option><option>One</option><option>Two</option><option>Three or more</option></select></Field><Field label={<Required>PRC application status</Required>}><select name="prc_status" required defaultValue=""><option value="" disabled>Select</option><option>Not yet started</option><option>Preparing documents</option><option>Submitted / under evaluation</option><option>Approved / Notice of Admission issued</option><option>Needs clarification</option></select></Field><div className="application-checks full"><span>Eligibility documents currently available</span><CheckLine name="doc_valid_id" label="Valid government-issued identification" /><CheckLine name="doc_diploma" label="Diploma or certificate of graduation" /><CheckLine name="doc_tor" label="Transcript of Records" /></div><Field label="Documents or eligibility concerns needing attention" full><textarea name="eligibility_concerns" placeholder="List missing documents, name discrepancies, pending records, or PRC questions." /></Field></div></section>

    <section className="application-section"><div className="application-section-head"><div><h2>C. Learning readiness profile</h2><p>Answer honestly so that the program can plan appropriate support.</p></div></div><div className="application-grid"><Field label="Strongest subject or topic"><textarea name="strong_topics" placeholder="Math and real estate law" /></Field><Field label="Weakest subject or topic"><textarea name="weak_topics" placeholder="Calculations and statistics" /></Field><SelectField name="computation_level" label={<Required>Comfort with computations</Required>} options={['Confident', 'Needs practice', 'Needs intensive support']} /><SelectField name="situational_level" label={<Required>Comfort with long situational questions</Required>} options={['Confident', 'Needs practice', 'Needs intensive support']} /><SelectField name="study_hours" label={<Required>Realistic weekly study time</Required>} options={['Below 3 hours', '3–4 hours', '5–7 hours', '8 hours or more']} /><SelectField name="internet" label={<Required>Internet access</Required>} options={['Reliable', 'Occasionally unstable', 'Limited']} /><SelectField name="device" label={<Required>Primary device</Required>} options={['Laptop/desktop', 'Tablet', 'Mobile phone only']} /><SelectField name="calculator" label="Calculator familiarity" options={['Confident', 'Basic knowledge', 'Needs training']} required={false} /><Field label="Work, health, or family circumstances that may affect attendance or study" full><textarea name="constraints" placeholder="I work night shifts but can study weekends" /></Field><Field label="Support expected from PASS-FIRST" full><textarea name="support_expected" placeholder="Weekly check-ins, tailored lesson plans, and coaching" /></Field></div></section>

    <AgreementChecks title="D. Participation commitment" names={[['commit_attend', 'I will attend scheduled live sessions and complete required catch-up work when absent.'], ['commit_study', 'I will reserve consistent weekly study time and follow the official PASS-FIRST study roadmap.'], ['commit_assess', 'I will complete assessments, assignments, error logs, and mock examinations honestly.'], ['commit_remediate', 'I agree to participate in required remediation, coaching, or retesting when needed.'], ['commit_communicate', 'I will communicate promptly when circumstances may prevent me from fulfilling program requirements.']]} />
    <AgreementChecks title="E. Materials, integrity, and data privacy" names={[['agree_nonsharing', 'I will not copy, sell, upload, forward, reproduce, or share program materials without written authorization.'], ['agree_integrity', 'I will answer assessments honestly and will not obtain or distribute unauthorized answer keys.'], ['agree_privacy', 'I consent to collection and processing of my enrollment, attendance, assessment, and performance data for program administration and learner support.'], ['agree_recording', 'I understand online sessions may be recorded for legitimate review-program use and I will observe professional conduct.'], ['promo_consent', 'Optional: I permit TREE Academy to request and use my testimonial, name, or image for promotional purposes, subject to my approval.']]} optional="promo_consent" />
    {(localError || error) && <p className="form-alert" role="alert">{localError || error}</p>}<div className="button-row"><button type="button" className="button button-ghost" onClick={onBack}>Back</button><PrimaryButton type="submit" disabled={submitting}>{submitting ? 'Saving application…' : 'Continue to document 1'}</PrimaryButton></div></form></>
}

function SelectField({ name, label, options, required = true }) { return <Field label={label}><select name={name} required={required} defaultValue=""><option value="" disabled>Select</option>{options.map((option) => <option key={option}>{option}</option>)}</select></Field> }
function CheckLine({ name, label, required = false }) { return <label className="application-check"><input type="checkbox" name={name} required={required} /><span><Check size={13} /></span>{label}</label> }
function AgreementChecks({ title, names, optional }) { return <section className="application-section"><div className="application-section-head"><div><h2>{title}</h2><p>{optional ? 'Check every box below to continue — the item marked optional is not required.' : 'Check every box below to continue.'}</p></div></div><div className="application-checks">{names.map(([name, label]) => <CheckLine key={name} name={name} label={label} required={name !== optional} />)}</div></section> }
