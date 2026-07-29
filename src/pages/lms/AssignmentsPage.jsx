import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, ChevronDown, ClipboardCheck, Download, ExternalLink, Paperclip, X } from 'lucide-react'
import { useToast } from '../../lib/toastContext.js'
import RichTextViewer from '../../components/RichTextViewer.jsx'
import SubmissionComments from '../../components/SubmissionComments.jsx'
import { downloadSubmissionAttachment, fetchAssignments, submitAssignment } from '../../lib/lms.js'

function dueLabel(dueAt) {
  if (!dueAt) return 'No due date'
  return `Due ${new Date(dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

function AssignmentRow({ assignment, canSubmit, onOpen, isOpen }) {
  const submission = assignment.mySubmission
  const state = submission?.grade != null ? 'done' : submission ? 'soon' : 'late'
  const stateLabel = submission?.grade != null ? `Graded · ${submission.grade}/${assignment.maxPoints}` : submission ? 'Submitted' : dueLabel(assignment.dueAt)
  return <div className="assignment-line">
    <span className={`task-check ${state}`}><Check size={13} /></span>
    <div><strong>{assignment.title}</strong><small>{assignment.courseTitle} · Individual assignment</small></div>
    <span className={`task-state ${state}`}>{stateLabel}</span>
    {canSubmit ? <button type="button" onClick={onOpen}>{isOpen ? 'Close' : submission ? 'View' : 'Open'} <ArrowRight size={15} /></button> : <span />}
  </div>
}

function SubmissionForm({ assignment, onClose }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const fileRef = useRef(null)
  const [body, setBody] = useState(assignment.mySubmission?.body ?? '')
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: () => submitAssignment(assignment._id, { body, file }),
    onSuccess: () => { toast.success(assignment.mySubmission ? 'Submission updated.' : 'Assignment submitted.'); queryClient.invalidateQueries({ queryKey: ['assignments'] }); queryClient.invalidateQueries({ queryKey: ['nav-assignments'] }); onClose() },
    onError: (submissionError) => setError(submissionError.message),
  })
  const canSubmit = body.trim() || file || assignment.mySubmission?.attachmentKey
  return <div className="assignment-line" style={{ display: 'block', padding: '17px 21px' }}>
    {assignment.instructions ? <RichTextViewer html={assignment.instructions} className="assignment-block-instructions" /> : <p style={{ margin: '0 0 10px', color: '#5f6a60', fontSize: 12, lineHeight: 1.6 }}>No additional instructions provided.</p>}
    {assignment.instructionsUrl && <a href={assignment.instructionsUrl} target="_blank" rel="noreferrer" className="lesson-resource-link" style={{ marginBottom: 10, display: 'inline-flex' }}><ExternalLink size={12} /> Instructions PDF</a>}
    {assignment.mySubmission?.feedback && <p style={{ margin: '0 0 10px', padding: 10, background: '#f4f6f1', borderRadius: 5, color: '#56604f', fontSize: 11 }}><strong>Instructor feedback:</strong> {assignment.mySubmission.feedback}</p>}
    <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Type your response here (optional if attaching a file)…" rows={5} style={{ width: '100%', padding: 10, border: '1px solid #d9e1d8', borderRadius: 4, font: 'inherit', fontSize: 12 }} />
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
      <input ref={fileRef} type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} hidden />
      <button type="button" className="button button-ghost button-compact" onClick={() => fileRef.current?.click()}><Paperclip size={13} /> {file ? file.name : 'Attach a file'}</button>
      {!file && assignment.mySubmission?.attachmentKey && <button type="button" className="button button-ghost button-compact" onClick={() => downloadSubmissionAttachment(assignment.mySubmission._id, assignment.mySubmission.attachmentName)}><Download size={13} /> {assignment.mySubmission.attachmentName || 'Current file'}</button>}
    </div>
    {error && <p className="form-alert" style={{ marginTop: 8 }}>{error}</p>}
    <div className="button-row" style={{ marginTop: 12 }}>
      <button type="button" className="button button-ghost" onClick={onClose}><X size={15} /> Cancel</button>
      <button type="button" className="button button-primary" disabled={mutation.isPending || !canSubmit} onClick={() => { setError(''); mutation.mutate() }}>{mutation.isPending ? 'Submitting…' : assignment.mySubmission ? 'Update submission' : 'Submit assignment'}</button>
    </div>
    {assignment.mySubmission?._id && <SubmissionComments submissionId={assignment.mySubmission._id} />}
  </div>
}

export default function AssignmentsPage({ role }) {
  const [openId, setOpenId] = useState(null)
  const { data: assignments = [], isLoading, error } = useQuery({ queryKey: ['assignments'], queryFn: fetchAssignments })
  const canSubmit = role === 'learner'

  return <>
    <div className="page-title-row"><div><p className="eyebrow">STAY ON TRACK</p><h1>Assignments</h1><p>Practice deliberately and get feedback from your instructors.</p></div><button className="filter-button">All courses <ChevronDown size={16} /></button></div>
    {isLoading && <div className="empty-state"><ClipboardCheck size={26} /><strong>Loading assignments…</strong></div>}
    {error && <div className="empty-state"><ClipboardCheck size={26} /><strong>Could not load assignments</strong><p>{error.message}</p></div>}
    {!isLoading && !error && assignments.length === 0 && <div className="empty-state"><ClipboardCheck size={26} /><strong>No assignments yet</strong><p>Your instructors haven’t published any assignments.</p></div>}
    <div className="assignment-table">
      {assignments.map((assignment) => <div key={assignment._id}>
        <AssignmentRow assignment={assignment} canSubmit={canSubmit} isOpen={openId === assignment._id} onOpen={() => setOpenId(openId === assignment._id ? null : assignment._id)} />
        {canSubmit && openId === assignment._id && <SubmissionForm assignment={assignment} onClose={() => setOpenId(null)} />}
      </div>)}
    </div>
  </>
}
