import { useCallback, useMemo, useRef, useState } from 'react'
import { Check, ExternalLink, FileCheck2, TriangleAlert } from 'lucide-react'
import PrimaryButton from '../PrimaryButton.jsx'
import SignatureField from './SignatureField.jsx'
import InteractivePdfFields from './InteractivePdfFields.jsx'
import { API_URL } from '../../lib/api.js'

const today = () => new Date().toISOString().slice(0, 10)

function Field({ label, children, full = false }) { return <label className={full ? 'application-field full' : 'application-field'}><span>{label}</span>{children}</label> }
const required = (label) => <>{label} <i aria-hidden="true">*</i></>

// Date fields are auto-stamped with today and locked (readOnly) — they record when the document was
// actually signed. Signature lines (kind: 'signature') render the live drawn signature + printed name.
// `label` names the field the way it reads on the page, for the missing-field alert below. It is
// ignored by InteractivePdfFields, which only reads kind/group/type/required/readOnly/multiline.
const realexFieldDefs = [
  { name: 'exam_reblex', group: 'exam_type' },
  { name: 'exam_realex', group: 'exam_type' },
  { name: 'p_name', required: true, label: 'Full legal name' },
  { name: 'p_address', required: true, multiline: true, label: 'Complete address' },
  { name: 'p_contact', required: true, label: 'Contact number' },
  { name: 'p_email', required: true, type: 'email', label: 'Email address' },
  { name: 'p_prc_app', required: true, label: 'PRC application status' },
  { name: 'p_signature', kind: 'signature' },
  { name: 'p_date', type: 'date', readOnly: true },
  { name: 'prov_date', type: 'date', readOnly: true },
]

const reclexFieldDefs = [
  { name: 'agmt_no' },
  { name: 'agmt_date', type: 'date', readOnly: true },
  { name: 'agmt_place', required: true, label: 'Place of signing' },
  { name: 'r_name', required: true, label: 'Full legal name' },
  { name: 'r_lic_type', required: true, label: 'License type' },
  { name: 'r_lic_no', required: true, label: 'License number' },
  { name: 'r_contact', required: true, label: 'Contact number' },
  { name: 'r_email', required: true, type: 'email', label: 'Email address' },
  { name: 'r_address', required: true, multiline: true, label: 'Complete address' },
  { name: 'r_target_exam', required: true, label: 'Target examination' },
  { name: 'b_signature', kind: 'signature' },
  { name: 'a_date', type: 'date', readOnly: true },
  { name: 'b_date', type: 'date', readOnly: true },
  { name: 'w1_name' },
  { name: 'w2_name' },
]

// Shown when the interactive document can't render — an older phone browser, or a failed chunk
// fetch. Deliberately the same field names as the overlay, so deriveFields and the server-side fill
// are byte-identical: the overlay is a presentation nicety, and the signed PDF has always been
// produced server-side from these values. Without this a learner whose PDF fails has no fields at
// all and simply cannot enroll.
function FallbackFields({ defs, defaults, isRealex }) {
  const pickExam = (event) => {
    const form = event.currentTarget.form
    form?.querySelectorAll('[data-pdf-group="exam_type"]').forEach((input) => { if (input !== event.currentTarget) input.checked = false })
  }
  return <div className="pdf-fallback">
    <p className="pdf-fallback-note"><TriangleAlert size={17} /><span>This device couldn&rsquo;t display the document viewer, so the same details are below as an ordinary form. Your signed agreement is produced from exactly these answers. Use &ldquo;View the original PDF&rdquo; below to read the full document first.</span></p>
    {isRealex && <div className="application-checks">
      <span>Examination you are enrolling for</span>
      <label className="application-check"><input type="checkbox" name="exam_reblex" data-pdf-group="exam_type" defaultChecked={Boolean(defaults.exam_reblex)} onChange={pickExam} /><span><Check size={13} /></span>REBLEX — broker licensure examination</label>
      <label className="application-check"><input type="checkbox" name="exam_realex" data-pdf-group="exam_type" defaultChecked={Boolean(defaults.exam_realex)} onChange={pickExam} /><span><Check size={13} /></span>REALEX — appraiser licensure examination</label>
    </div>}
    <div className="application-grid">
      {defs.filter((field) => field.label).map((field) => <Field key={field.name} label={field.required ? required(field.label) : field.label} full={field.multiline}>
        {field.multiline
          ? <textarea name={field.name} defaultValue={defaults[field.name] ?? ''} required={field.required} />
          : <input type={field.type ?? 'text'} name={field.name} defaultValue={defaults[field.name] ?? ''} required={field.required} />}
      </Field>)}
    </div>
    {/* Dates are stamped automatically and are readOnly in the interactive view — still submitted. */}
    {defs.filter((field) => field.readOnly).map((field) => <input key={field.name} type="hidden" name={field.name} value={defaults[field.name] ?? ''} readOnly />)}
  </div>
}

// Required fields sit inside the PDF overlay, where a native validation bubble can land off-screen
// or on a page the applicant has not scrolled to — reportValidity() alone made the button look dead.
// Naming what is missing mirrors how ApplicationStep reports step 1.
const missingFieldLabels = (form, defs) => {
  const labels = { consent: 'Electronic-signature consent', ...Object.fromEntries(defs.filter((field) => field.label).map((field) => [field.name, field.label])) }
  const missing = []
  form.querySelectorAll('[required]').forEach((field) => {
    if (field.checkValidity()) return
    const label = labels[field.name] ?? field.name
    if (!missing.includes(label)) missing.push(label)
  })
  return missing
}

export default function DocumentStep({ enrollmentId, type, applicant, application, onSubmit, onBack, submitting, error }) {
  const [signature, setSignature] = useState('')
  const [localError, setLocalError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [pdfUnavailable, setPdfUnavailable] = useState(false)
  // Stable identity: InteractivePdfFields lists this in its effect deps, so an inline arrow would
  // re-run the whole load on every render.
  const handleUnavailable = useCallback(() => setPdfUnavailable(true), [])
  const formRef = useRef(null)
  const isRealex = type === 'realex-reblex'
  const original = isRealex ? '/enrollment-documents/realex-reblex.pdf' : '/enrollment-documents/reclex.pdf'
  const fieldDefs = isRealex ? realexFieldDefs : reclexFieldDefs
  const defaults = useMemo(() => isRealex
    ? { exam_reblex: true, p_name: applicant.name, p_contact: applicant.phone, p_email: applicant.email, p_prc_app: application?.prc_status ?? '', p_date: today(), prov_date: today(), p_address: application?.address ?? '' }
    : { agmt_date: today(), agmt_place: application?.agmt_place ?? '', r_name: applicant.name, r_lic_type: application?.r_lic_type ?? '', r_lic_no: application?.r_lic_no ?? '', r_contact: applicant.phone, r_email: applicant.email, r_address: application?.address ?? '', r_target_exam: 'REBLEX 2027 First Batch', a_date: today(), b_date: today() },
  [isRealex, applicant, application])

  const deriveFields = (form) => {
    const data = Object.fromEntries(new FormData(form))
    if (isRealex) {
      data.exam_type = data.exam_reblex ? 'REBLEX' : 'REALEX'
      delete data.exam_reblex
      delete data.exam_realex
    }
    return data
  }

  const typedSignatureName = (form) => new FormData(form).get('signatureName')?.trim() ?? ''

  // Shared by submit and the PDF download — the download path was silently returning on an invalid
  // form too, so both now report the same reason instead of appearing to do nothing.
  const validate = (form, action) => {
    const missing = missingFieldLabels(form, fieldDefs)
    if (missing.length) {
      setLocalError(`Please complete the following required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`)
      form.querySelector('[required]:invalid')?.focus()
      return false
    }
    if (isRealex && !form.querySelector('[name="exam_reblex"]:checked, [name="exam_realex"]:checked')) { setLocalError('Please select REBLEX or REALEX in the document above.'); return false }
    if (!signature) { setLocalError(`Please draw your signature before ${action}.`); return false }
    if (typedSignatureName(form).toLocaleLowerCase() !== (applicant?.name ?? '').trim().toLocaleLowerCase()) { setLocalError('Your typed signature must match your full legal name.'); return false }
    setLocalError('')
    return true
  }

  const submit = (event) => {
    event.preventDefault()
    const form = event.currentTarget
    if (!validate(form, 'submitting this document')) return
    onSubmit({ fields: deriveFields(form), signatureName: typedSignatureName(form), signatureDataUrl: signature, consent: true })
  }

  const downloadPdf = async () => {
    const form = formRef.current
    if (!form || !validate(form, 'downloading the PDF')) return
    const signatureName = typedSignatureName(form)
    setDownloading(true)
    try {
      const fields = deriveFields(form)
      delete fields.consent
      const response = await fetch(`${API_URL}/api/enrollments/${enrollmentId}/documents/${type}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields, signatureName, signatureDataUrl: signature, consent: true }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Unable to generate the PDF preview.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${isRealex ? 'REALEX-REBLEX' : 'RECLEX'}-agreement.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setLocalError(error.message)
    } finally {
      setDownloading(false)
    }
  }

  return <><p className="eyebrow">STEP 2 OF 4 · REVIEW &amp; SIGN</p><h1>Review and sign<br /><em>your agreement.</em></h1><p className="lead">Complete the required fields directly in the document below, then sign your acknowledgment. Your drawn signature and printed name appear on the agreement as you sign, and a signed, flattened copy is stored with your enrollment record.</p><form ref={formRef} className="application-form document-form" onSubmit={submit} noValidate>{pdfUnavailable
      ? <FallbackFields defs={fieldDefs} defaults={defaults} isRealex={isRealex} />
      : <div className="document-preview"><InteractivePdfFields src={original} fields={fieldDefs} defaults={defaults} signatureImage={signature} signatureName={applicant.name} onUnavailable={handleUnavailable} /></div>}<a className="document-template-link" href={original} target="_blank" rel="noreferrer"><FileCheck2 size={17} /> View the original PDF <ExternalLink size={14} /></a><section className="application-section"><div className="application-section-head"><div><h2>Electronic signature</h2><p>Draw your signature below. It appears on the agreement above in real time, over your legal name.</p></div></div><div className="application-grid"><Field label={required('Full legal name (from your enrollment)')}><input name="signatureName" defaultValue={applicant.name} readOnly /></Field><div className="full"><SignatureField onChange={setSignature} /></div><label className="application-check full"><input type="checkbox" name="consent" required /><span><Check size={13} /></span>I agree that my drawn signature and printed legal name are my electronic signature for this document.</label></div></section>{(localError || error) && <p className="form-alert" role="alert">{localError || error}</p>}<div className="button-row"><button type="button" className="button button-ghost" onClick={onBack}>Back</button><button type="button" className="button button-secondary" onClick={downloadPdf} disabled={downloading || submitting}>{downloading ? 'Downloading PDF…' : 'Download completed PDF'}</button><PrimaryButton type="submit" disabled={submitting}>{submitting ? 'Creating signed PDF…' : 'Continue to payment'}</PrimaryButton></div></form></>
}
