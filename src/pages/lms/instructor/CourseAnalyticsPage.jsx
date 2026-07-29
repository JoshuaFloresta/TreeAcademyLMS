import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, BarChart3, CheckCircle2, GraduationCap, TrendingUp } from 'lucide-react'
import StatCard from '../../../components/lms/StatCard.jsx'
import { fetchCourseAnalytics, fetchCourses } from '../../../lib/lms.js'

export default function CourseAnalyticsPage({ role }) {
  const [courseId, setCourseId] = useState('')
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses, enabled: role !== 'learner' })
  const activeCourseId = courseId || courses[0]?._id || ''
  const { data, isLoading } = useQuery({ queryKey: ['course-analytics', activeCourseId], queryFn: () => fetchCourseAnalytics(activeCourseId), enabled: Boolean(activeCourseId) })

  if (role === 'learner') return <p className="operations-note">This workspace is available to instructors and admins only.</p>

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">TEACHING WORKSPACE</p><h1>Course analytics</h1><p>Completion, engagement, and the learners who need a nudge.</p></div>
      <label className="gradebook-course-select"><GraduationCap size={16} /><select value={activeCourseId} onChange={(event) => setCourseId(event.target.value)} aria-label="Select course">{courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}</select></label>
    </div>
    {!activeCourseId ? <p className="operations-note">Create a course to see analytics.</p>
      : isLoading || !data ? <p className="operations-note">Crunching analytics…</p>
      : <>
        <div className="stat-grid">
          <StatCard icon={TrendingUp} label="Completion rate" value={`${data.completionRate}%`} detail={`${data.completedLearners}/${data.learnerCount} finished`} trend={`${data.moduleCount} modules`} />
          <StatCard icon={CheckCircle2} label="Average grade" value={data.avgGrade == null ? '—' : `${data.avgGrade}%`} detail="Across graded work" trend={`${data.assignmentCount} assignments`} />
          <StatCard icon={BarChart3} label="Submission rate" value={`${data.submissionRate}%`} detail="Of expected submissions" trend="Engagement" />
        </div>
        <div className="analytics-grid">
          <section className="admin-breakdown">
            <h3>Module completion</h3>
            {data.moduleBreakdown.length === 0 ? <p className="operations-note">No published modules yet.</p>
              : data.moduleBreakdown.map((module) => <div className="admin-breakdown-row" key={module.id}>
                <strong style={{ textTransform: 'none' }}>{module.title}</strong>
                <div className="admin-bar"><i style={{ width: `${module.percent}%` }} /></div>
                <span>{module.percent}%</span>
              </div>)}
          </section>
          <section className="admin-breakdown">
            <h3><AlertTriangle size={15} style={{ verticalAlign: '-2px', color: '#b0862f' }} /> At-risk learners ({data.atRisk.length})</h3>
            {data.atRisk.length === 0 ? <p className="operations-note">Everyone is on track. 🎉</p>
              : <div className="at-risk-list">{data.atRisk.map((learner) => <div className="at-risk-row" key={learner.id}>
                <div><strong>{learner.name}</strong><small>{learner.email}</small></div>
                <div className="at-risk-meta"><span>{learner.progressPercent}% done</span>{learner.avgGrade != null && <span>{learner.avgGrade}% avg</span>}</div>
                <div className="at-risk-reasons">{learner.reasons.map((reason) => <span key={reason}>{reason}</span>)}</div>
              </div>)}</div>}
          </section>
        </div>
      </>}
  </>
}
