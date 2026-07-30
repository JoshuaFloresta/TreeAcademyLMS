import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ClipboardCheck, Download, ExternalLink, Paperclip } from 'lucide-react'
import { useToast } from '../../lib/toastContext.js'
import RichTextViewer from '../../components/RichTextViewer.jsx'
import SubmissionComments from '../../components/SubmissionComments.jsx'
import { downloadSubmissionAttachment, fetchAssignment, submitAssignment } from '../../lib/lms.js'
import Loading from '../../components/Loading.jsx'

const dueLabel = (dueAt) => (dueAt ? `Due ${new Date(dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : 'No due date')

// Mounted only once the assignment (and any existing submission) has loaded, so its form state
// seeds correctly from props on first render instead of needing an effect to resync it.
function SubmissionForm({ assignmentId, submission, maxPoints, onSaved }) {
  const toast = useToast()
  const fileRef = useRef(null)
  const [body, setBody] = useState(submission?.body ?? '')
  const [file, setFile] = useState(null)
  const mutation = useMutation({
    mutationFn: () => submitAssignment(assignmentId, { body, file }),
    onSuccess: () => { toast.success(submission ? 'Submission updated.' : 'Submitted.'); setFile(null); onSaved() },
    onError: (e) => toast.error(e.message),
  })
  const canSubmit = body.trim() || file || submission?.attachmentKey

  return <>
    {submission?.grade != null && <p className="assignment-grade">Graded: {submission.grade}/{maxPoints}{submission.feedback ? <span> — {submission.feedback}</span> : null}</p>}
    <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write your response (optional if attaching a file)…" rows={6} className="assignment-response" />
    <div className="assignment-dropzone">
      <input ref={fileRef} type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} hidden />
      <button type="button" className="button button-ghost button-compact" onClick={() => fileRef.current?.click()}><Paperclip size={13} /> {file ? file.name : 'Attach a file'}</button>
      {!file && submission?.attachmentKey && <button type="button" className="button button-ghost button-compact" onClick={() => downloadSubmissionAttachment(submission._id, submission.attachmentName)}><Download size={13} /> {submission.attachmentName || 'Current file'}</button>}
    </div>
    <button type="button" className="button button-primary button-compact" disabled={mutation.isPending || !canSubmit} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Submitting…' : submission ? 'Update submission' : 'Submit assignment'}</button>
    {submission?._id && <SubmissionComments submissionId={submission._id} />}
  </>
}

export default function AssignmentDetailPage({ role, assignmentId }) {
  const queryClient = useQueryClient()
  const { data: assignment, isLoading, error } = useQuery({ queryKey: ['assignment', assignmentId], queryFn: () => fetchAssignment(assignmentId) })

  if (isLoading) return <Loading block label="Loading assignment…" />
  if (error || !assignment) return <div className="empty-state"><ClipboardCheck size={26} /><strong>Assignment not found</strong></div>

  return <>
    <Link to="/assignments" className="filter-button" style={{ marginBottom: 18, display: 'inline-flex' }}><ArrowLeft size={15} /> Back to assignments</Link>
    <div className="page-title-row">
      <div>
        <p className="eyebrow">{assignment.courseTitle}{assignment.moduleTitle ? ` · PHASE ${assignment.phaseNumber ?? ''} — ${assignment.moduleTitle}` : ''}{assignment.lessonTitle ? ` · ${assignment.lessonTitle}` : ''}</p>
        <h1>{assignment.title}</h1>
        <p>{dueLabel(assignment.dueAt)} · {assignment.maxPoints} points</p>
      </div>
    </div>

    <div className="settings-card" style={{ display: 'block', maxWidth: 640 }}>
      {assignment.instructions && <RichTextViewer html={assignment.instructions} className="assignment-block-instructions" />}
      {assignment.instructionsUrl && <a href={assignment.instructionsUrl} target="_blank" rel="noreferrer" className="lesson-resource-link"><ExternalLink size={12} /> Instructions PDF</a>}
      {!assignment.instructions && !assignment.instructionsUrl && <p className="operations-note">No additional instructions provided.</p>}

      {role === 'learner' && <SubmissionForm
        assignmentId={assignmentId}
        submission={assignment.mySubmission}
        maxPoints={assignment.maxPoints}
        onSaved={() => { queryClient.invalidateQueries({ queryKey: ['assignment', assignmentId] }); queryClient.invalidateQueries({ queryKey: ['assignments'] }) }}
      />}
      {role !== 'learner' && <p className="operations-note" style={{ marginTop: 16 }}>Grade submissions for this assignment from Submissions.</p>}
    </div>
  </>
}
