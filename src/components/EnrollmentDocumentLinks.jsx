import { useState } from 'react'
import { Download, FileText } from 'lucide-react'
import { useToast } from '../lib/toastContext.js'
import { downloadEnrollmentDocument, enrollmentDocumentFilename, openEnrollmentDocument } from '../lib/admin.js'

const formatDate = (value) => (value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '')

// Opens the submitted admission form / signed agreement in a new tab, or saves a copy of it. Either
// way the server streams the file after re-checking the caller, so there's no shareable URL to leak.
// Shared by every staff screen that lists enrollment paperwork (Enrollment Management,
// Enrollment Documents, and a member's Profile page) so the busy/open/download behavior stays in one place.
export default function EnrollmentDocumentLinks({ enrollmentId, applicantName, documents, emptyLabel = 'Not submitted' }) {
  const toast = useToast()
  const [busy, setBusy] = useState('')
  if (!documents?.length) return emptyLabel ? <small className="enrollment-docs-empty">{emptyLabel}</small> : null
  const open = async (type) => {
    setBusy(`view:${type}`)
    try { await openEnrollmentDocument(enrollmentId, type) } catch (e) { toast.error(e.message) } finally { setBusy('') }
  }
  const download = async (type) => {
    setBusy(`download:${type}`)
    try { await downloadEnrollmentDocument(enrollmentId, type, enrollmentDocumentFilename(applicantName, type)) } catch (e) { toast.error(e.message) } finally { setBusy('') }
  }
  return <span className="enrollment-docs">
    {documents.map((document) => <span className="enrollment-doc-group" key={document.type}>
      <button type="button" className="enrollment-doc-link" title={`${document.label}${document.signedAt ? ` · ${formatDate(document.signedAt)}` : ''}`} onClick={() => open(document.type)} disabled={busy === `view:${document.type}`}>
        {busy === `view:${document.type}` ? <span className="spinner spinner-sm" /> : <FileText size={12} />}
        {document.type === 'application' ? 'Admission form' : 'Agreement'}
      </button>
      <button type="button" className="enrollment-doc-link enrollment-doc-download" title="Download a copy" aria-label={`Download ${document.label}`} onClick={() => download(document.type)} disabled={busy === `download:${document.type}`}>
        {busy === `download:${document.type}` ? <span className="spinner spinner-sm" /> : <Download size={12} />}
      </button>
    </span>)}
  </span>
}
