import { useMemo, useState } from 'react'
import { Check, ExternalLink, FileCheck2 } from 'lucide-react'
import PrimaryButton from '../PrimaryButton.jsx'
import SignatureField from './SignatureField.jsx'
import InteractivePdfFields from './InteractivePdfFields.jsx'
import { courseAgreementTemplateUrl } from '../../lib/api.js'

function Field({ label, children, full = false }) { return <label className={full ? 'application-field full' : 'application-field'}><span>{label}</span>{children}</label> }
const required = (label) => <>{label} <i aria-hidden="true">*</i></>

// A checkbox gets its own single-member "group" so it renders through InteractivePdfFields' grouped
// branch — the only one that honors defaultChecked. The plain, ungrouped checkbox branch there only
// exists for a mutually-exclusive pair (see DocumentStep's exam_type) and isn't relevant here since
// generic fields are read straight off the PDF, not hand-authored as a pair.
function toWidgetFields(schema) {
  return schema.map((field) => field.type === 'signature'
    ? { name: field.name, kind: 'signature' }
    : field.type === 'checkbox'
      ? { name: field.name, required: field.required, group: field.name }
      : { name: field.name, required: field.required, multiline: field.multiline })
}

export default function GenericDocumentStep({ courseSlug, schema, applicant, onSubmit, onBack, submitting, error }) {
  const [signature, setSignature] = useState('')
  const [localError, setLocalError] = useState('')
  const templateUrl = courseAgreementTemplateUrl(courseSlug)
  const widgetFields = useMemo(() => toWidgetFields(schema), [schema])

  const submit = (event) => {
    event.preventDefault()
    const form = event.currentTarget
    if (!form.reportValidity()) return
    if (!signature) return setLocalError('Please draw your signature before submitting this document.')
    const signatureName = new FormData(form).get('signatureName')?.trim()
    if (signatureName.toLocaleLowerCase() !== applicant.name.toLocaleLowerCase()) return setLocalError('Your typed signature must match your full legal name.')
    setLocalError('')
    onSubmit({ fields: Object.fromEntries(new FormData(form)), signatureName, signatureDataUrl: signature, consent: true })
  }

  return <>
    <p className="eyebrow">STEP 2 OF 2 · REVIEW &amp; SIGN</p>
    <h1>Review and sign<br /><em>your agreement.</em></h1>
    <p className="lead">Complete the required fields directly in the document below, then sign your acknowledgment. Your drawn signature and printed name appear on the agreement as you sign, and a signed, flattened copy is saved with your application.</p>
    <form className="application-form document-form" onSubmit={submit} noValidate>
      <div className="document-preview"><InteractivePdfFields src={templateUrl} fields={widgetFields} signatureImage={signature} signatureName={applicant.name} /></div>
      <a className="document-template-link" href={templateUrl} target="_blank" rel="noreferrer"><FileCheck2 size={17} /> View the original PDF <ExternalLink size={14} /></a>
      <section className="application-section">
        <div className="application-section-head"><div><h2>Electronic signature</h2><p>Draw your signature below. It appears on the agreement above in real time, over your legal name.</p></div></div>
        <div className="application-grid">
          <Field label={required('Full legal name (from your application)')}><input name="signatureName" defaultValue={applicant.name} readOnly /></Field>
          <div className="full"><SignatureField onChange={setSignature} /></div>
          <label className="application-check full"><input type="checkbox" name="consent" required /><span><Check size={13} /></span>I agree that my drawn signature and printed legal name are my electronic signature for this document.</label>
        </div>
      </section>
      {(localError || error) && <p className="form-alert" role="alert">{localError || error}</p>}
      <div className="button-row">
        <button type="button" className="button button-ghost" onClick={onBack}>Back</button>
        <PrimaryButton type="submit" disabled={submitting}>{submitting ? 'Creating signed PDF…' : 'Submit application'}</PrimaryButton>
      </div>
    </form>
  </>
}
