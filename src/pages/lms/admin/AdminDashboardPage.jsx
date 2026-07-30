import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, CheckCircle2, ClipboardCheck, Flag, GraduationCap, Megaphone, ScrollText, UserPlus, Users } from 'lucide-react'
import StatCard from '../../../components/lms/StatCard.jsx'
import { fetchAdminDashboard } from '../../../lib/admin.js'
import Loading from '../../../components/Loading.jsx'

const sum = (map) => Object.values(map ?? {}).reduce((total, value) => total + value, 0)
const titleize = (value) => value.replace(/[._]/g, ' ').replace(/\b\w/, (char) => char.toUpperCase())
const monthLabel = (month) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' })
const timeAgo = (date) => {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(date).getTime()) / 60_000))
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Grouped monthly bars, two series — palette validated for CVD + contrast (green #2e7d4f / gold #c08a2e).
function GrowthChart({ growth }) {
  const max = Math.max(1, ...growth.map((point) => Math.max(point.signups, point.enrollments)))
  return <div>
    <div className="growth-legend"><span><i style={{ background: '#2e7d4f' }} /> New signups</span><span><i style={{ background: '#c08a2e' }} /> Enrollments</span></div>
    <div className="growth-chart" role="img" aria-label="Signups and enrollments per month, last six months">
      {growth.map((point) => <div className="growth-col" key={point.month} title={`${monthLabel(point.month)}: ${point.signups} signups, ${point.enrollments} enrollments`}>
        <div className="growth-bars">
          <i style={{ height: `${Math.round((point.signups / max) * 100)}%`, background: '#2e7d4f' }} />
          <i style={{ height: `${Math.round((point.enrollments / max) * 100)}%`, background: '#c08a2e' }} />
        </div>
        <small>{monthLabel(point.month)}</small>
      </div>)}
    </div>
  </div>
}

export default function AdminDashboardPage({ user }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['admin-dashboard'], queryFn: fetchAdminDashboard })

  if (isLoading) return <><div className="page-title-row"><div><p className="eyebrow">PLATFORM ADMIN</p><h1>Dashboard</h1></div></div><Loading label="Loading dashboard…" /></>
  if (error) return <><div className="page-title-row"><div><p className="eyebrow">PLATFORM ADMIN</p><h1>Dashboard</h1></div></div><p className="form-alert" role="alert">{error.message}</p></>

  const pendingItems = [
    { count: data.pending.enrollments, label: 'Enrollments awaiting approval', to: '/admin/enrollments', icon: GraduationCap },
    { count: data.pending.courses, label: 'Courses awaiting publish', to: '/admin/courses', icon: BookOpen },
    { count: data.pending.reports, label: 'Flagged content / open reports', to: '/admin/reports', icon: Flag },
  ]
  const activity = [
    ...data.recentUsers.map((row) => ({ id: `user-${row._id}`, icon: UserPlus, text: `New ${row.role}: ${row.name}`, at: row.createdAt })),
    ...data.recentCourses.map((row) => ({ id: `course-${row._id}`, icon: BookOpen, text: `Course ${row.isPublished ? 'published' : 'drafted'}: ${row.title}`, at: row.createdAt })),
    ...data.recentActions.map((row) => ({ id: `audit-${row.id}`, icon: ScrollText, text: `${row.actor} — ${titleize(row.action)}`, at: row.createdAt })),
  ].sort((first, second) => new Date(second.at) - new Date(first.at)).slice(0, 8)

  return <>
    <div className="page-title-row"><div><p className="eyebrow">PLATFORM ADMIN</p><h1>Dashboard</h1><p>Welcome back, {user?.name?.split(' ')[0] ?? 'Admin'} — here’s the platform at a glance.</p></div></div>
    <div className="stat-grid">
      <StatCard icon={Users} label="Total users" value={sum(data.usersByRole)} detail={`${data.usersByRole.learner ?? 0} learners · ${data.usersByRole.instructor ?? 0} instructors · ${data.usersByRole.admin ?? 0} admins`} trend="" />
      <StatCard icon={BookOpen} label="Total courses" value={data.courses.total} detail={`${data.courses.published} published`} trend="" />
      <StatCard icon={GraduationCap} label="Active enrollments" value={sum(data.activeEnrollmentsByPathway)} detail={['broker', 'consultant', 'appraiser'].map((pathway) => `${data.activeEnrollmentsByPathway[pathway] ?? 0} ${pathway}`).join(' · ')} trend="" />
      <StatCard icon={CheckCircle2} label="Course completion" value={`${data.completionRate}%`} detail="Platform-wide average" trend={data.completionRate >= 50 ? 'Healthy' : 'Needs attention'} gold={data.completionRate < 50} />
    </div>
    <section className="quick-actions" style={{ marginTop: 22 }}>
      <Link to="/admin/users" className="quick-action"><UserPlus size={18} /><span><strong>Add user</strong><small>Create an account</small></span></Link>
      <Link to="/admin/courses" className="quick-action"><BookOpen size={18} /><span><strong>Create course</strong><small>Open course catalog</small></span></Link>
      <Link to="/announcements" className="quick-action"><Megaphone size={18} /><span><strong>Send announcement</strong><small>Notify the academy</small></span></Link>
    </section>
    <div className="dashboard-grid" style={{ marginTop: 22 }}>
      <section className="main-stack">
        <section className="assignments-card">
          <div className="card-header"><div><p className="eyebrow">LAST 6 MONTHS</p><h2>Signups & enrollments</h2></div><Link to="/admin/analytics">Global analytics</Link></div>
          <div style={{ padding: '0 21px 20px' }}><GrowthChart growth={data.growth} /></div>
        </section>
        <section className="assignments-card">
          <div className="card-header"><div><p className="eyebrow">ACTIVITY</p><h2>Recent activity</h2></div><Link to="/admin/audit">Audit logs</Link></div>
          {activity.length === 0 && <p className="operations-note" style={{ margin: '0 21px 18px' }}>No recent activity yet.</p>}
          {activity.map((item) => <div className="task-row" key={item.id}><span className="task-check done"><item.icon size={13} /></span><div><strong>{item.text}</strong></div><span className="task-state done">{timeAgo(item.at)}</span></div>)}
        </section>
      </section>
      <section className="side-stack">
        <article className="event-card">
          <div className="card-header"><div><p className="eyebrow">NEEDS REVIEW</p><h2>Pending approvals</h2></div><ClipboardCheck size={18} /></div>
          <div style={{ padding: '0 21px 18px', display: 'grid', gap: 10 }}>
            {pendingItems.map((item) => <Link to={item.to} className="pending-approval-row" key={item.label}><item.icon size={15} /><span>{item.label}</span><b className={item.count > 0 ? 'gold-badge' : 'zero-badge'}>{item.count}</b></Link>)}
          </div>
        </article>
      </section>
    </div>
  </>
}
