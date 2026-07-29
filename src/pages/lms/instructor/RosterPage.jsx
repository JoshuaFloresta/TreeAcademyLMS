import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, CheckCircle2, Search, Users } from 'lucide-react'
import StatCard from '../../../components/lms/StatCard.jsx'
import StatusPill from '../../../components/StatusPill.jsx'
import { fetchLearners } from '../../../lib/lms.js'

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
  const { data: learners = [], isLoading, error } = useQuery({ queryKey: ['staff-learners'], queryFn: fetchLearners, enabled: role !== 'learner' })

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase()
    if (!needle) return learners
    return learners.filter((learner) => learner.name?.toLowerCase().includes(needle) || learner.email?.toLowerCase().includes(needle))
  }, [learners, term])

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
    <div className="roster-search"><Search size={17} /><input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search by name or email" aria-label="Search learners" /></div>
    {error && <p className="form-alert" role="alert">{error.message}</p>}
    <div className="admin-table admin-table-roster">
      <div className="admin-table-head"><span>LEARNER</span><span>STATUS</span><span>COURSES</span><span>MODULES DONE</span><span>LAST SEEN</span></div>
      {isLoading ? <p className="operations-note">Loading roster…</p>
        : !filtered.length ? <p className="operations-note">{term ? 'No learners match that search.' : 'No learners yet.'}</p>
        : filtered.map((learner) => <div className="admin-table-row" key={learner.id}>
          <span className="roster-learner"><span className="workspace-avatar">{initialsOf(learner.name)}</span><span><strong>{learner.name}</strong><small>{learner.email}</small></span></span>
          <span><StatusPill kind={statusKind[learner.status] ?? 'gold'}>{learner.status}</StatusPill></span>
          <span>{learner.enrolledCourses}</span>
          <span>{learner.completedModules}</span>
          <span>{lastSeen(learner.lastSeenAt)}</span>
        </div>)}
    </div>
  </>
}
