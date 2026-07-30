import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ClipboardCheck, Clock3, FileText, GraduationCap, ListChecks, Search } from 'lucide-react'
import StatusPill from '../../../components/StatusPill.jsx'
import StatCard from '../../../components/lms/StatCard.jsx'
import { fetchCourseSubmissions, fetchCourses } from '../../../lib/lms.js'
import Loading from '../../../components/Loading.jsx'

const formatWhen = (value) => (value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const initialsOf = (name) => (name || 'U').trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()

export default function SubmissionsPage({ role }) {
  const [courseId, setCourseId] = useState('')
  const [kind, setKind] = useState('all')
  const [status, setStatus] = useState('all')
  const [term, setTerm] = useState('')
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses, enabled: role !== 'learner' })
  const activeCourseId = courseId || courses[0]?._id || ''
  const { data, isLoading } = useQuery({ queryKey: ['course-submissions', activeCourseId], queryFn: () => fetchCourseSubmissions(activeCourseId), enabled: Boolean(activeCourseId) })

  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase()
    return (data?.rows ?? []).filter((row) => (kind === 'all' || row.kind === kind)
      && (status === 'all' || row.status === status)
      && (!needle || row.learner?.name?.toLowerCase().includes(needle) || row.learner?.email?.toLowerCase().includes(needle) || row.title.toLowerCase().includes(needle)))
  }, [data, kind, status, term])

  const all = data?.rows ?? []
  const pending = all.filter((row) => row.status === 'needs_grading').length

  if (role === 'learner') return <p className="operations-note">This workspace is available to instructors and admins only.</p>

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">TEACHING WORKSPACE</p><h1>Submissions</h1><p>Everything your learners have handed in — assignments and quizzes — with grading and feedback in one place.</p></div>
      <label className="gradebook-course-select"><GraduationCap size={16} /><select value={activeCourseId} onChange={(event) => setCourseId(event.target.value)} aria-label="Filter by course">{courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}</select></label>
    </div>

    <div className="stat-grid">
      <StatCard icon={Clock3} label="Needs grading" value={String(pending).padStart(2, '0')} detail="Awaiting your review" trend="Action" gold />
      <StatCard icon={ClipboardCheck} label="Assignments" value={String(all.filter((row) => row.kind === 'assignment').length).padStart(2, '0')} detail="Submitted" trend="This course" />
      <StatCard icon={ListChecks} label="Quiz attempts" value={String(all.filter((row) => row.kind === 'quiz').length).padStart(2, '0')} detail="Recorded" trend="This course" />
    </div>

    <div className="submissions-filters">
      <div className="roster-search"><Search size={17} /><input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search learner or title" aria-label="Search submissions" /></div>
      <div className="submissions-chips" role="group" aria-label="Filter by type">
        {[['all', 'All types'], ['assignment', 'Assignments'], ['quiz', 'Quizzes']].map(([value, label]) => <button key={value} type="button" className={kind === value ? 'active' : undefined} onClick={() => setKind(value)}>{label}</button>)}
      </div>
      <div className="submissions-chips" role="group" aria-label="Filter by status">
        {[['all', 'All'], ['needs_grading', 'Needs grading'], ['graded', 'Graded']].map(([value, label]) => <button key={value} type="button" className={status === value ? 'active' : undefined} onClick={() => setStatus(value)}>{label}</button>)}
      </div>
    </div>

    {!activeCourseId ? <p className="operations-note">Create a course to start reviewing submissions.</p>
      : isLoading ? <Loading block label="Loading submissions…" />
      : !rows.length ? <div className="empty-state"><ClipboardCheck size={26} /><strong>{all.length ? 'Nothing matches those filters' : 'No submissions yet'}</strong><p>{all.length ? 'Try clearing the search or switching filters.' : 'Once learners hand in assignments or take quizzes, their work appears here.'}</p></div>
      : <div className="admin-table admin-table-submissions">
        <div className="admin-table-head"><span>LEARNER</span><span>WORK</span><span>TYPE</span><span>SUBMITTED</span><span>SCORE</span><span>ACTIONS</span></div>
        {rows.map((row) => <div className="admin-table-row" key={`${row.kind}-${row.id}`}>
          <span className="roster-learner"><span className="workspace-avatar">{initialsOf(row.learner?.name)}</span><span><strong>{row.learner?.name ?? 'Unknown learner'}</strong><small>{row.learner?.email}</small></span></span>
          <span><strong>{row.title}</strong>{row.hasAttachment && <small><FileText size={10} /> attachment</small>}</span>
          <span><span className={`submission-kind ${row.kind}`}>{row.kind === 'quiz' ? 'Quiz' : 'Assignment'}</span></span>
          <span>{formatWhen(row.submittedAt)}</span>
          <span>{row.status === 'needs_grading'
            ? <StatusPill kind="gold">Needs grading</StatusPill>
            : <span className="submission-score"><CheckCircle2 size={13} /> {row.score ?? '—'}<small>/{row.maxPoints}</small></span>}</span>
          <span className="admin-row-actions"><Link className="button button-ghost button-compact" to={`/submissions/${row.kind}/${row.id}`}>{row.status === 'needs_grading' ? 'Grade' : 'View'}</Link></span>
        </div>)}
      </div>}
  </>
}
