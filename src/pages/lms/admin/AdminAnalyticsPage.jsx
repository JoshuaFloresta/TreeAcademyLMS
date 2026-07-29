import { useQuery } from '@tanstack/react-query'
import { BarChart3, BookOpen, CreditCard, FileText, LifeBuoy, Users } from 'lucide-react'
import StatCard from '../../../components/lms/StatCard.jsx'
import { fetchAnalytics } from '../../../lib/admin.js'

const peso = (value) => `₱${Number(value ?? 0).toLocaleString('en-PH')}`
const sum = (map) => Object.values(map ?? {}).reduce((total, value) => total + value, 0)
const titleize = (value) => value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())

function Breakdown({ title, data }) {
  const entries = Object.entries(data ?? {})
  const total = sum(data) || 1
  return <article className="admin-breakdown">
    <h3>{title}</h3>
    {entries.length === 0 ? <p className="operations-note">No data yet.</p> : entries.map(([key, value]) => <div className="admin-breakdown-row" key={key}>
      <span>{titleize(key)}</span>
      <div className="admin-bar"><i style={{ width: `${Math.round((value / total) * 100)}%` }} /></div>
      <strong>{value}</strong>
    </div>)}
  </article>
}

export default function AdminAnalyticsPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['admin-analytics'], queryFn: fetchAnalytics })

  if (isLoading) return <><div className="page-title-row"><div><p className="eyebrow">PLATFORM ADMIN</p><h1>Global Analytics</h1></div></div><p className="operations-note">Loading platform metrics…</p></>
  if (error) return <><div className="page-title-row"><div><p className="eyebrow">PLATFORM ADMIN</p><h1>Global Analytics</h1></div></div><p className="form-alert" role="alert">{error.message}</p></>

  return <>
    <div className="page-title-row"><div><p className="eyebrow">PLATFORM ADMIN</p><h1>Global Analytics</h1><p>Platform-wide reporting on revenue, usage, and course performance.</p></div></div>
    <div className="stat-grid">
      <StatCard icon={CreditCard} label="Confirmed revenue" value={peso(data.revenue)} detail="Approved enrollments" gold trend="₱" />
      <StatCard icon={Users} label="Total users" value={sum(data.usersByRole)} detail={`${data.usersByRole.instructor ?? 0} instructors · ${data.usersByRole.learner ?? 0} learners`} trend="" />
      <StatCard icon={BookOpen} label="Courses" value={`${data.courses.published}/${data.courses.total}`} detail="Published / total" trend="" />
      <StatCard icon={FileText} label="Submissions" value={data.submissions} detail="Assignments submitted" trend="" />
      <StatCard icon={LifeBuoy} label="Open tickets" value={data.openTickets} detail="Awaiting support" trend="" />
      <StatCard icon={BarChart3} label="Open reports" value={data.openReports} detail="Awaiting review" trend="" />
    </div>
    <div className="admin-breakdown-grid">
      <Breakdown title="Users by role" data={data.usersByRole} />
      <Breakdown title="Users by status" data={data.usersByStatus} />
      <Breakdown title="Enrollments by status" data={data.enrollmentsByStatus} />
    </div>
  </>
}
