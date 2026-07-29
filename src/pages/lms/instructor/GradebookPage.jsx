import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, Download, GraduationCap } from 'lucide-react'
import Modal from '../../../components/Modal.jsx'
import SubmissionComments from '../../../components/SubmissionComments.jsx'
import { useToast } from '../../../lib/toastContext.js'
import { downloadSubmissionAttachment, fetchCourses, fetchGradebook, gradeSubmission } from '../../../lib/lms.js'

const pct = (grade, max) => (grade == null ? null : Math.round((grade / (max || 100)) * 100))

// Replaces window.prompt with a real grading panel: the learner's written response and attachment
// are visible alongside the grade field and a proper feedback comment box.
function GradeModal({ submission, assignment, onClose, onSaved }) {
  const toast = useToast()
  const [grade, setGrade] = useState(submission?.grade ?? '')
  const [feedback, setFeedback] = useState(submission?.feedback ?? '')
  const [error, setError] = useState('')
  const mutation = useMutation({ mutationFn: (payload) => gradeSubmission(submission.id, payload) })
  const submit = async (event) => {
    event.preventDefault()
    const value = Number(grade)
    if (grade === '' || Number.isNaN(value) || value < 0 || value > assignment.maxPoints) { setError(`Enter a number between 0 and ${assignment.maxPoints}.`); return }
    setError('')
    try { await mutation.mutateAsync({ grade: value, feedback: feedback.trim() || undefined }); toast.success('Grade saved.'); onSaved() }
    // Deliberately not closing the modal here — the comment thread below stays reachable so the
    // instructor can immediately follow up without reopening the just-graded cell.
    catch (e) { setError(e.message); toast.error(e.message) }
  }
  return <Modal open={Boolean(submission)} onClose={onClose} labelledBy="grade-modal-title" className="grade-modal">
    <p className="eyebrow">GRADE SUBMISSION</p>
    <h2 id="grade-modal-title">{assignment?.title}</h2>
    {submission?.body && <p className="grade-modal-response">{submission.body}</p>}
    {submission?.attachmentKey && <button type="button" className="button button-ghost button-compact" onClick={() => downloadSubmissionAttachment(submission.id, submission.attachmentName)}><Download size={13} /> {submission.attachmentName || 'Download attachment'}</button>}
    <form onSubmit={submit} style={{ marginTop: 18, display: 'grid', gap: 12 }}>
      <label className="application-field"><span>Grade (out of {assignment?.maxPoints})</span><input type="number" min={0} max={assignment?.maxPoints} value={grade} onChange={(e) => setGrade(e.target.value)} /></label>
      <label className="application-field"><span>Feedback</span><textarea rows={4} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Comments for the learner (optional)" /></label>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className="confirm-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save grade'}</button></div>
    </form>
    {submission?.id && <SubmissionComments submissionId={submission.id} />}
  </Modal>
}

export default function GradebookPage({ role }) {
  const queryClient = useQueryClient()
  const [courseId, setCourseId] = useState('')
  const [grading, setGrading] = useState(null)
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses, enabled: role !== 'learner' })
  const activeCourseId = courseId || courses[0]?._id || ''
  const { data: book, isLoading } = useQuery({ queryKey: ['gradebook', activeCourseId], queryFn: () => fetchGradebook(activeCourseId), enabled: Boolean(activeCourseId) })

  const cellIndex = useMemo(() => {
    const map = new Map()
    for (const submission of book?.submissions ?? []) map.set(`${submission.learnerId}:${submission.assignmentId}`, submission)
    return map
  }, [book])

  const refreshList = () => {
    queryClient.invalidateQueries({ queryKey: ['gradebook', activeCourseId] })
    queryClient.invalidateQueries({ queryKey: ['staff-overview'] })
  }
  const refresh = () => {
    refreshList()
    setGrading(null)
  }

  if (role === 'learner') return <p className="operations-note">This workspace is available to instructors and admins only.</p>

  const assignments = book?.assignments ?? []
  const learners = book?.learners ?? []

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">TEACHING WORKSPACE</p><h1>Gradebook</h1><p>Review submissions and record grades for every learner in a course.</p></div>
      <label className="gradebook-course-select"><GraduationCap size={16} /><select value={activeCourseId} onChange={(event) => setCourseId(event.target.value)} aria-label="Select course">{courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}</select></label>
    </div>
    {!activeCourseId ? <p className="operations-note">Create a course to start grading.</p>
      : isLoading ? <p className="operations-note">Loading gradebook…</p>
      : !assignments.length ? <p className="operations-note">This course has no assignments yet. Add one from the course builder.</p>
      : !learners.length ? <p className="operations-note">No learners are enrolled in this course yet.</p>
      : <div className="gradebook-scroll"><table className="gradebook-table">
        <thead><tr><th className="gradebook-corner">Learner</th>{assignments.map((assignment) => <th key={assignment.id}>{assignment.title}<small>/{assignment.maxPoints}</small></th>)}<th>Average</th></tr></thead>
        <tbody>{learners.map((learner) => {
          const percents = assignments.map((assignment) => pct(cellIndex.get(`${learner.id}:${assignment.id}`)?.grade, assignment.maxPoints)).filter((value) => value != null)
          const average = percents.length ? Math.round(percents.reduce((sum, value) => sum + value, 0) / percents.length) : null
          return <tr key={learner.id}>
            <th className="gradebook-learner" scope="row"><strong>{learner.name}</strong><small>{learner.email}</small></th>
            {assignments.map((assignment) => {
              const submission = cellIndex.get(`${learner.id}:${assignment.id}`)
              if (!submission) return <td key={assignment.id} className="gradebook-cell empty">—</td>
              if (submission.grade == null) return <td key={assignment.id} className="gradebook-cell pending"><button type="button" onClick={() => setGrading({ submission, assignment })}><ClipboardCheck size={13} /> Grade</button></td>
              return <td key={assignment.id} className="gradebook-cell graded"><button type="button" onClick={() => setGrading({ submission, assignment })}>{submission.grade}<small>/{assignment.maxPoints}</small></button></td>
            })}
            <td className="gradebook-cell average">{average == null ? '—' : `${average}%`}</td>
          </tr>
        })}</tbody>
      </table></div>}
    <GradeModal submission={grading?.submission} assignment={grading?.assignment} onClose={refresh} onSaved={refreshList} />
  </>
}
