import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, FileText, Paperclip } from 'lucide-react'
import SubmissionComments from '../../../components/SubmissionComments.jsx'
import Loading from '../../../components/Loading.jsx'
import { useToast } from '../../../lib/toastContext.js'
import { downloadSubmissionAttachment, fetchQuizAttempt, fetchSubmissionAttachmentUrl, fetchSubmissionDetail, gradeSubmission, reviewQuizAttempt } from '../../../lib/lms.js'

const formatWhen = (value) => (value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

// Answers arrive shaped by question type — an index for multiple choice, text for a written one,
// an array for enumeration/matching. Render whatever came back rather than assuming one shape.
function formatAnswer(answer) {
  if (answer == null || answer === '') return <em>No answer</em>
  if (Array.isArray(answer)) return answer.filter((entry) => entry != null && entry !== '').join(', ') || <em>No answer</em>
  if (typeof answer === 'object') return Object.entries(answer).map(([key, value]) => `${key} → ${value}`).join(', ')
  return String(answer)
}

// Renders the uploaded file in place where the browser can (images, PDFs) and falls back to a
// download for anything else — an instructor shouldn't have to leave the page to see the work.
function AttachmentPreview({ submissionId, filename }) {
  const [state, setState] = useState({ status: 'loading' })
  useEffect(() => {
    let objectUrl = null
    let cancelled = false
    fetchSubmissionAttachmentUrl(submissionId)
      .then(({ url, type }) => {
        objectUrl = url
        if (cancelled) return URL.revokeObjectURL(url)
        setState({ status: 'ready', url, type })
      })
      .catch((error) => { if (!cancelled) setState({ status: 'error', message: error.message }) })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [submissionId])

  if (state.status === 'loading') return <Loading label="Loading attachment…" />
  if (state.status === 'error') return <p className="form-alert" role="alert">{state.message}</p>
  const isImage = state.type?.startsWith('image/')
  const isPdf = state.type === 'application/pdf'
  return <div className="review-attachment">
    <div className="review-attachment-head">
      <span><Paperclip size={13} /> {filename || 'Attachment'}</span>
      <button type="button" className="button button-ghost button-compact" onClick={() => downloadSubmissionAttachment(submissionId, filename)}><Download size={13} /> Download</button>
    </div>
    {isImage && <img src={state.url} alt={filename || 'Submitted attachment'} />}
    {isPdf && <iframe src={state.url} title={filename || 'Submitted attachment'} />}
    {!isImage && !isPdf && <p className="operations-note"><FileText size={15} /> This file type can’t be previewed here — download it to open.</p>}
  </div>
}

function AssignmentReview({ id, onDone }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['submission-detail', id], queryFn: () => fetchSubmissionDetail(id) })
  const [grade, setGrade] = useState('')
  const [touched, setTouched] = useState(false)
  const [formError, setFormError] = useState('')
  const mutation = useMutation({ mutationFn: (payload) => gradeSubmission(id, payload) })

  if (isLoading) return <Loading block label="Loading submission…" />
  if (error) return <div className="empty-state"><FileText size={26} /><strong>Could not load this submission</strong><p>{error.message}</p></div>

  // Uncontrolled until the instructor types, so the saved grade shows without a state-sync effect.
  const gradeValue = touched ? grade : (data.grade ?? '')
  const submit = async (event) => {
    event.preventDefault()
    const value = Number(gradeValue)
    if (gradeValue === '' || Number.isNaN(value) || value < 0 || value > data.maxPoints) { setFormError(`Enter a number between 0 and ${data.maxPoints}.`); return }
    setFormError('')
    try {
      await mutation.mutateAsync({ grade: value })
      toast.success('Grade saved.')
      queryClient.invalidateQueries({ queryKey: ['submission-detail', id] })
      onDone()
    } catch (e) { setFormError(e.message); toast.error(e.message) }
  }

  return <ReviewLayout
    title={data.title}
    learner={data.learner}
    submittedAt={data.submittedAt}
    preview={<>
      {data.body && <div className="review-response"><span className="review-label">Written response</span><p>{data.body}</p></div>}
      {data.hasAttachment && <AttachmentPreview submissionId={id} filename={data.attachmentName} />}
      {!data.body && !data.hasAttachment && <div className="empty-state"><FileText size={26} /><strong>Nothing submitted</strong><p>This learner didn’t attach a file or write a response.</p></div>}
    </>}
    grading={<form onSubmit={submit} className="review-form">
      <label className="application-field"><span>Grade (out of {data.maxPoints})</span><input type="number" min={0} max={data.maxPoints} value={gradeValue} onChange={(event) => { setTouched(true); setGrade(event.target.value) }} autoFocus /></label>
      {formError && <p className="form-alert" role="alert">{formError}</p>}
      <button className="button button-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : data.grade == null ? 'Save grade' : 'Update grade'}</button>
      {data.grade != null && <p className="review-saved">Currently graded {data.grade}/{data.maxPoints}.</p>}
    </form>}
    commentsFor={{ id, kind: 'assignment' }}
  />
}

function QuizReview({ id, onDone }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['quiz-attempt', id], queryFn: () => fetchQuizAttempt(id) })
  const [score, setScore] = useState('')
  const [touched, setTouched] = useState(false)
  const mutation = useMutation({ mutationFn: (payload) => reviewQuizAttempt(id, payload) })

  if (isLoading) return <Loading block label="Loading attempt…" />
  if (error) return <div className="empty-state"><FileText size={26} /><strong>Could not load this attempt</strong><p>{error.message}</p></div>

  const scoreValue = touched ? score : (data.reviewedScore ?? '')
  const save = async (event) => {
    event.preventDefault()
    try {
      await mutation.mutateAsync({ reviewedScore: scoreValue === '' ? null : Number(scoreValue) })
      toast.success('Review saved.')
      queryClient.invalidateQueries({ queryKey: ['quiz-attempt', id] })
      onDone()
    } catch (e) { toast.error(e.message) }
  }

  return <ReviewLayout
    title={data.title}
    learner={data.learner}
    submittedAt={data.submittedAt}
    preview={<ol className="quiz-answers">
      {data.results.map((result, index) => <li key={index} className={result.correct === null ? 'pending' : result.correct ? 'correct' : 'wrong'}>
        <p className="quiz-answer-prompt">{result.prompt}</p>
        <p className="quiz-answer-given"><span className="review-label">Answered</span>{formatAnswer(data.answers[index])}</p>
        <span className="quiz-answer-verdict">{result.correct === null ? 'Needs your review' : result.correct ? 'Correct' : 'Incorrect'}</span>
      </li>)}
    </ol>}
    grading={<form onSubmit={save} className="review-form">
      <p className="review-score">Auto-graded <strong>{data.score}/{data.total}</strong> ({data.percent}%)</p>
      <label className="application-field"><span>Override score (out of {data.total})</span><input type="number" min={0} max={data.total} value={scoreValue} onChange={(event) => { setTouched(true); setScore(event.target.value) }} placeholder={String(data.score)} /><small>Leave blank to keep the automatic score.</small></label>
      <button className="button button-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save review'}</button>
      {data.reviewedAt && <p className="review-saved">Reviewed {formatWhen(data.reviewedAt)}.</p>}
    </form>}
    commentsFor={{ id, kind: 'quiz' }}
  />
}

// Shared two-column shell: the work on the left, everything needed to act on it on the right.
function ReviewLayout({ title, learner, submittedAt, preview, grading, commentsFor }) {
  return <>
    <div className="page-title-row">
      <div>
        <p className="eyebrow">REVIEWING SUBMISSION</p>
        <h1>{title}</h1>
        <p>{learner?.name ?? 'Unknown learner'}{learner?.email ? ` · ${learner.email}` : ''} · submitted {formatWhen(submittedAt)}</p>
      </div>
      <Link to="/submissions" className="button button-ghost"><ArrowLeft size={15} /> All submissions</Link>
    </div>
    <div className="review-split">
      <section className="review-pane">{preview}</section>
      <aside className="review-side">
        <div className="review-card"><h2>Grading</h2>{grading}</div>
        <div className="review-card"><SubmissionComments submissionId={commentsFor.id} kind={commentsFor.kind} /></div>
      </aside>
    </div>
  </>
}

export default function SubmissionReviewPage({ role, kind, id }) {
  const queryClient = useQueryClient()
  const refreshFeed = () => {
    queryClient.invalidateQueries({ queryKey: ['course-submissions'] })
    queryClient.invalidateQueries({ queryKey: ['staff-overview'] })
  }
  if (role === 'learner') return <p className="operations-note">This workspace is available to instructors and admins only.</p>
  return kind === 'quiz' ? <QuizReview id={id} onDone={refreshFeed} /> : <AssignmentReview id={id} onDone={refreshFeed} />
}
