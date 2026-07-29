import { useMemo, useRef, useState } from 'react'
import { Check, ExternalLink, FileCheck2 } from 'lucide-react'
import PrimaryButton from '../PrimaryButton.jsx'
import SignatureField from './SignatureField.jsx'
import InteractivePdfFields from './InteractivePdfFields.jsx'
import { API_URL } from '../../lib/api.js'

const today = () => new Date().toISOString().slice(0, 10)

function Field({ label, children, full = false }) { return <label className={full ? 'application-field full' : 'application-field'}><span>{label}</span>{children}</label> }
const required = (label) => <>{label} <i aria-hidden="true">*</i></>

// Date fields are auto-stamped with today and locked (readOnly) — they record when the document was
// actually signed. Signature lines (kind: 'signature') render the live drawn signature + printed name.
const realexFieldDefs = [
  { name: 'exam_reblex', group: 'exam_type' },
  { name: 'exam_realex', group: 'exam_type' },
  { name: 'p_name', required: true },
  { name: 'p_address', required: true, multiline: true },
  { name: 'p_contact', required: true },
  { name: 'p_email', required: true, type: 'email' },
  { name: 'p_prc_app', required: true },
  { name: 'p_signature', kind: 'signature' },
  { name: 'p_date', type: 'date', readOnly: true },
  { name: 'prov_date', type: 'date', readOnly: true },
]

const reclexFieldDefs = [
  { name: 'agmt_no' },
  { name: 'agmt_date', type: 'date', readOnly: true },
  { name: 'agmt_place', required: true },
  { name: 'r_name', required: true },
  { name: 'r_lic_type', required: true },
  { name: 'r_lic_no', required: true },
  { name: 'r_contact', required: true },
  { name: 'r_email', required: true, type: 'email' },
  { name: 'r_address', required: true, multiline: true },
  { name: 'r_target_exam', required: true },
  { name: 'b_signature', kind: 'signature' },
  { name: 'a_date', type: 'date', readOnly: true },
  { name: 'b_date', type: 'date', readOnly: true },
  { name: 'w1_name' },
  { name: 'w2_name' },
]

export default function DocumentStep({ enrollmentId, type, applicant, application, onSubmit, onBack, submitting, error }) {
  const [signature, setSignature] = useState('')
  const [localError, setLocalError] = useState('')
  const [downloading, setDownloading] = useState(false)
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

  const submit = (event) => {
    event.preventDefault()
    const form = event.currentTarget
    if (!form.reportValidity()) return
    if (isRealex && !form.querySelector('[name="exam_reblex"]:checked, [name="exam_realex"]:checked')) return setLocalError('Please select REBLEX or REALEX in the document above.')
    if (!signature) return setLocalError('Please draw your signature before submitting this document.')
    const signatureName = new FormData(form).get('signatureName')?.trim()
    if (signatureName.toLocaleLowerCase() !== applicant.name.toLocaleLowerCase()) return setLocalError('Your typed signature must match your full legal name.')
    setLocalError('')
    onSubmit({ fields: deriveFields(form), signatureName, signatureDataUrl: signature, consent: true })
  }

  const downloadPdf = async () => {
    if (!formRef.current) return
    const form = formRef.current
    if (!form.reportValidity()) return
    if (isRealex && !form.querySelector('[name="exam_reblex"]:checked, [name="exam_realex"]:checked')) return setLocalError('Please select REBLEX or REALEX in the document above.')
    if (!signature) return setLocalError('Please draw your signature before downloading the PDF.')
    const signatureName = new FormData(form).get('signatureName')?.trim()
    if (signatureName.toLocaleLowerCase() !== applicant.name.toLocaleLowerCase()) return setLocalError('Your typed signature must match your full legal name.')
    setLocalError('')
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

  return <><p className="eyebrow">STEP 2 OF 4 · REVIEW &amp; SIGN</p><h1>Review and sign<br /><em>your agreement.</em></h1><p className="lead">Complete the required fields directly in the document below, then sign your acknowledgment. Your drawn signature and printed name appear on the agreement as you sign, and a signed, flattened copy is stored with your enrollment record.</p><form ref={formRef} className="application-form document-form" onSubmit={submit} noValidate><div className="document-preview"><InteractivePdfFields src={original} fields={fieldDefs} defaults={defaults} signatureImage={signature} signatureName={applicant.name} /></div><a className="document-template-link" href={original} target="_blank" rel="noreferrer"><FileCheck2 size={17} /> View the original PDF <ExternalLink size={14} /></a><section className="application-section"><div className="application-section-head"><div><h2>Electronic signature</h2><p>Draw your signature below. It appears on the agreement above in real time, over your legal name.</p></div></div><div className="application-grid"><Field label={required('Full legal name (from your enrollment)')}><input name="signatureName" defaultValue={applicant.name} readOnly /></Field><div className="full"><SignatureField onChange={setSignature} /></div><label className="application-check full"><input type="checkbox" name="consent" required /><span><Check size={13} /></span>I agree that my drawn signature and printed legal name are my electronic signature for this document.</label></div></section>{(localError || error) && <p className="form-alert" role="alert">{localError || error}</p>}<div className="button-row"><button type="button" className="button button-ghost" onClick={onBack}>Back</button><button type="button" className="button button-secondary" onClick={downloadPdf} disabled={downloading || submitting}>{downloading ? 'Downloading PDF…' : 'Download completed PDF'}</button><PrimaryButton type="submit" disabled={submitting}>{submitting ? 'Creating signed PDF…' : 'Continue to payment'}</PrimaryButton></div></form></>
}
