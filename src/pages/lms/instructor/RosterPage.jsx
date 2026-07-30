import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { BookOpen, CheckCircle2, Filter, IdCard, Search, Users, X } from 'lucide-react'
import StatCard from '../../../components/lms/StatCard.jsx'
import StatusPill from '../../../components/StatusPill.jsx'
import { fetchCourses, fetchLearners } from '../../../lib/lms.js'
import Loading from '../../../components/Loading.jsx'

const statusKind = { active: 'green', invited: 'gold', inactive: 'red', suspended: 'red' }
const initialsOf = (name) => (name || 'U').trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
const lastSeen = (value) => {
  if (!value) return 'Never'
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function RosterPage({ role }) {
  const [term, setTerm] = useState('')
  const [status, setStatus] = useState('')
  const [courseId, setCourseId] = useState('')
  const [activity, setActivity] = useState('all')
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses, enabled: role !== 'learner' })
  // Status and course go to the server; name search and the activity window stay local so typing
  // stays instant and doesn't fire a request per keystroke.
  const { data: learners = [], isLoading, error } = useQuery({ queryKey: ['staff-learners', status, courseId], queryFn: () => fetchLearners({ status, courseId }), enabled: role !== 'learner' })

  // Read once, not per render — the purity rule bars calling Date.now() during render, and a
  // "30 days ago" boundary doesn't need finer resolution than "whenever this page loaded" anyway.
  const [cutoff] = useState(() => Date.now() - 30 * 86_400_000)
  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase()
    return learners.filter((learner) => {
      if (needle && !(learner.name?.toLowerCase().includes(needle) || learner.email?.toLowerCase().includes(needle))) return false
      if (activity === 'recent' && !(learner.lastSeenAt && new Date(learner.lastSeenAt).getTime() >= cutoff)) return false
      if (activity === 'dormant' && learner.lastSeenAt && new Date(learner.lastSeenAt).getTime() >= cutoff) return false
      return true
    })
  }, [learners, term, activity, cutoff])

  const resetFilters = () => { setTerm(''); setStatus(''); setCourseId(''); setActivity('all') }
  const filtersActive = Boolean(term || status || courseId || activity !== 'all')

  const activeCount = learners.filter((learner) => learner.status === 'active').length
  const enrolledCount = learners.filter((learner) => learner.enrolledCourses > 0).length

  if (role === 'learner') return <p className="operations-note">This workspace is available to instructors and admins only.</p>

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">TEACHING WORKSPACE</p><h1>Student roster</h1><p>Every learner across your courses, with enrollment and activity at a glance.</p></div>
    </div>
    <div className="stat-grid">
      <StatCard icon={Users} label="Total learners" value={String(learners.length).padStart(2, '0')} detail={`${activeCount} active`} trend="All courses" />
      <StatCard icon={BookOpen} label="Enrolled" value={String(enrolledCount).padStart(2, '0')} detail="In at least one course" trend="Coverage" />
      <StatCard icon={CheckCircle2} label="Modules completed" value={String(learners.reduce((sum, learner) => sum + (learner.completedModules ?? 0), 0))} detail="Across all learners" trend="Progress" gold />
    </div>
    <div className="submissions-filters">
      <div className="roster-search"><Search size={17} /><input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search by name or email" aria-label="Search learners" /></div>
      <label className="roster-filter"><Filter size={13} /><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
        <option value="">All statuses</option>
        {['active', 'invited', 'inactive', 'suspended'].map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
      </select></label>
      <label className="roster-filter"><BookOpen size={13} /><select value={courseId} onChange={(event) => setCourseId(event.target.value)} aria-label="Filter by course">
        <option value="">All courses</option>
        {courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}
      </select></label>
      <div className="submissions-chips" role="group" aria-label="Filter by activity">
        {[['all', 'Any activity'], ['recent', 'Active 30d'], ['dormant', 'Dormant']].map(([value, label]) => <button key={value} type="button" className={activity === value ? 'active' : undefined} onClick={() => setActivity(value)}>{label}</button>)}
      </div>
      {filtersActive && <button type="button" className="button button-ghost button-compact" onClick={resetFilters}><X size={13} /> Clear</button>}
    </div>
    {error && <p className="form-alert" role="alert">{error.message}</p>}
    <div className="admin-table admin-table-roster">
      <div className="admin-table-head"><span>LEARNER</span><span>STATUS</span><span>COURSES</span><span>MODULES DONE</span><span>LAST SEEN</span><span /></div>
      {isLoading ? <Loading label="Loading roster…" />
        : !filtered.length ? <p className="operations-note">{filtersActive ? 'No learners match those filters.' : 'No learners yet.'}</p>
        : filtered.map((learner) => <div className="admin-table-row" key={learner.id}>
          <span className="roster-learner"><span className="workspace-avatar">{initialsOf(learner.name)}</span><span><strong>{learner.name}</strong><small>{learner.email}</small></span></span>
          <span><StatusPill kind={statusKind[learner.status] ?? 'gold'}>{learner.status}</StatusPill></span>
          <span>{learner.enrolledCourses}</span>
          <span>{learner.completedModules}</span>
          <span>{lastSeen(learner.lastSeenAt)}</span>
          {/* The roster is where an instructor already looks a learner up, so it's also the way in
              to that learner's details and the enrollment paperwork they signed. */}
          <span className="admin-row-actions"><Link className="button button-ghost button-compact" to={`/profile?member=${learner.id}`}><IdCard size={14} /> Profile</Link></span>
        </div>)}
    </div>
  </>
}
