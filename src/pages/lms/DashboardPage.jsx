import { Link, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Bell, BookOpen, CalendarDays, Check, ChevronRight, ClipboardCheck, Clock3, Play, Users, Video } from 'lucide-react'
import StatCard from '../../components/lms/StatCard.jsx'
import { fetchAssignments, fetchCalendar, fetchCourses, fetchGradingQueue, fetchNotifications, fetchStaffOverview } from '../../lib/lms.js'

const dayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long' })

function dueLabel(dueAt) {
  if (!dueAt) return 'No due date'
  const due = new Date(dueAt)
  const days = Math.ceil((due.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000)
  if (days < 0) return `Overdue`
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

// A session that started in the last three hours still counts as "upcoming" — a live review you
// can still join shouldn't fall off the card the moment it begins. Matches the rule CalendarPage
// and the learner dashboard already use, so "upcoming" means the same thing everywhere it appears.
const meetingTypes = new Set(['live_review', 'office_hours'])
function upcomingMeetings(events) {
  const cutoff = Date.now() - 3 * 60 * 60 * 1000
  return events
    .filter((event) => meetingTypes.has(event.eventType) && new Date(event.startsAt).getTime() >= cutoff)
    .sort((first, second) => new Date(first.startsAt) - new Date(second.startsAt))
}

function InstructorDashboard({ user }) {
  const { data: overview } = useQuery({ queryKey: ['staff-overview'], queryFn: fetchStaffOverview })
  const { data: queue = [] } = useQuery({ queryKey: ['grading-queue'], queryFn: fetchGradingQueue })
  const { data: events = [] } = useQuery({ queryKey: ['calendar'], queryFn: () => fetchCalendar() })
  const meetings = upcomingMeetings(events).slice(0, 4)

  return <>
    <div className="dashboard-welcome"><div><p className="eyebrow">{dayLabel.format(new Date()).toUpperCase()}</p><h1>Welcome back, {user?.name?.split(' ')[0] ?? 'there'}.</h1><p>Here’s what needs your attention across your courses.</p></div></div>
    <div className="stat-grid">
      <StatCard icon={BookOpen} label="Courses" value={String(overview?.courseCount ?? 0).padStart(2, '0')} detail={`${overview?.publishedCount ?? 0} published`} trend="Manage in builder" />
      <StatCard icon={Users} label="Learners" value={String(overview?.learnerCount ?? 0).padStart(2, '0')} detail="Active across roster" trend="View roster" />
      <StatCard icon={ClipboardCheck} label="Pending grading" value={String(overview?.pendingGrading ?? 0).padStart(2, '0')} detail={overview?.pendingGrading ? 'Submissions waiting' : 'All caught up'} trend={overview?.pendingGrading ? 'Action needed' : 'On track'} gold={Boolean(overview?.pendingGrading)} />
    </div>
    <div className="dashboard-grid">
      <section className="main-stack">
        <section className="assignments-card">
          <div className="card-header"><div><p className="eyebrow">NEEDS GRADING</p><h2>Grading queue</h2></div><Link to="/submissions">Open submissions <ArrowRight size={15} /></Link></div>
          {queue.length === 0 && <div className="task-row"><span className="task-check done"><Check size={13} /></span><div><strong>All caught up</strong><small>No submissions waiting for a grade</small></div></div>}
          {/* The row already showed a chevron; now it actually goes somewhere — straight to the
              review page for that submission, which is what the queue is for. */}
          {queue.slice(0, 5).map((item) => <Link className="task-row" to={`/submissions/assignment/${item.id}`} key={item.id}><span className="task-check late"><ClipboardCheck size={13} /></span><div><strong>{item.assignmentTitle}</strong><small>{item.learner?.name ?? 'Learner'} · {item.courseTitle}</small></div><span className="task-state late">{item.submittedAt ? new Date(item.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span><ChevronRight size={18} /></Link>)}
        </section>
        <section className="quick-actions">
          <Link to="/builder" className="quick-action"><BookOpen size={18} /><span><strong>Course builder</strong><small>Author modules & lessons</small></span></Link>
          <Link to="/roster" className="quick-action"><Users size={18} /><span><strong>Student roster</strong><small>Enrollment & activity</small></span></Link>
          <Link to="/calendar" className="quick-action"><CalendarDays size={18} /><span><strong>Calendar</strong><small>Schedule sessions</small></span></Link>
        </section>
      </section>
      <section className="side-stack">
        <article className="event-card">
          <div className="card-header"><div><p className="eyebrow">UPCOMING</p><h2>Meetings &amp; classes</h2></div><Link to="/calendar"><CalendarDays size={18} /></Link></div>
          {meetings.length === 0
            ? <div className="card-empty"><Video size={20} /><strong>No upcoming events</strong><p>Live reviews and office hours you schedule will appear here.</p></div>
            : meetings.map((event) => <div className="event-next" key={event._id}>
              <span>{new Date(event.startsAt).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()} <b>{new Date(event.startsAt).getDate()}</b></span>
              <p>{event.title} <small>{event.courseTitle ? `${event.courseTitle} · ` : ''}{new Date(event.startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}{event.eventType === 'office_hours' ? ' · Office hours' : ''}</small></p>
              {event.meetingUrl && <a href={event.meetingUrl} target="_blank" rel="noopener noreferrer" className="event-next-join" aria-label={`Join ${event.title}`}><Video size={13} /></a>}
            </div>)}
          <Link to="/calendar" className="button button-ghost full">Open calendar <ArrowRight size={16} /></Link>
        </article>
      </section>
    </div>
  </>
}

function LearnerDashboard({ user }) {
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses })
  const { data: assignments = [] } = useQuery({ queryKey: ['nav-assignments', user?.id], queryFn: fetchAssignments })
  const { data: events = [] } = useQuery({ queryKey: ['calendar'], queryFn: () => fetchCalendar() })
  const { data: notifications = [] } = useQuery({ queryKey: ['nav-notifications', user?.id], queryFn: fetchNotifications })

  const overallProgress = courses.length ? Math.round(courses.reduce((sum, course) => sum + (course.progressPercent ?? 0), 0) / courses.length) : 0
  const dueAssignments = assignments.filter((assignment) => !assignment.mySubmission).sort((first, second) => new Date(first.dueAt ?? 0) - new Date(second.dueAt ?? 0))
  const inProgressCourse = courses.find((course) => (course.progressPercent ?? 0) > 0 && (course.progressPercent ?? 0) < 100) ?? courses[0]
  const now = new Date()
  // A session that started in the last three hours is still "coming up" — a live review you can
  // still join shouldn't disappear from the card the moment it begins.
  const futureEvents = events
    .filter((event) => new Date(event.startsAt).getTime() >= now.getTime() - 3 * 60 * 60 * 1000)
    .sort((first, second) => new Date(first.startsAt) - new Date(second.startsAt))
  // The stat card claims "in the next 7 days", so count exactly that. It previously counted a
  // list already truncated to two, which meant the number could never read higher than 02.
  const eventsThisWeek = futureEvents.filter((event) => new Date(event.startsAt).getTime() <= now.getTime() + 7 * 86_400_000)
  const [nextEvent, followingEvent] = futureEvents
  const latestNotification = notifications[0]

  return <>
    <div className="dashboard-welcome"><div><p className="eyebrow">{dayLabel.format(new Date()).toUpperCase()}</p><h1>Good morning, {user?.name?.split(' ')[0] ?? 'there'}.</h1><p>Here’s what’s moving in your learning today.</p></div></div>
    <div className="stat-grid">
      <StatCard icon={BookOpen} label="Learning progress" value={`${overallProgress}%`} detail="Across all pathways" trend={overallProgress > 0 ? 'Keep going' : 'Get started'} />
      <StatCard icon={ClipboardCheck} label="Assignments due" value={String(dueAssignments.length).padStart(2, '0')} detail={dueAssignments[0] ? dueLabel(dueAssignments[0].dueAt) : 'All caught up'} trend={dueAssignments.length > 0 ? 'Action needed' : 'On track'} gold={dueAssignments.length > 0} />
      <StatCard icon={CalendarDays} label="Upcoming events" value={String(eventsThisWeek.length).padStart(2, '0')} detail={eventsThisWeek.length ? 'In the next 7 days' : 'Nothing scheduled'} trend="View calendar" />
    </div>
    <div className="dashboard-grid">
      <section className="main-stack">
        {inProgressCourse && <article className="learning-card">
          <div className="learning-head"><div><p className="eyebrow">CONTINUE LEARNING</p><h2>{inProgressCourse.title}</h2></div><span className="module-count">{inProgressCourse.completedModuleCount} / {inProgressCourse.moduleCount} modules</span></div>
          <div className="learning-body"><div className="lesson-symbol"><Play size={20} fill="currentColor" /></div><div><small>{inProgressCourse.progressPercent}% COMPLETE</small><h3>Pick up where you left off</h3><p>{inProgressCourse.moduleCount - inProgressCourse.completedModuleCount} module{inProgressCourse.moduleCount - inProgressCourse.completedModuleCount === 1 ? '' : 's'} remaining</p></div><Link to="/catalog" className="button button-primary">Resume <ArrowRight size={16} /></Link></div>
          <div className="progress long"><span style={{ width: `${inProgressCourse.progressPercent}%` }} /></div>
        </article>}
        <section className="assignments-card">
          <div className="card-header"><div><p className="eyebrow">YOUR WORK</p><h2>Assignment queue</h2></div><Link to="/assignments">View all <ArrowRight size={15} /></Link></div>
          {/* "Nothing to do" and "nothing exists yet" are different situations and deserve
              different wording — congratulating someone for finishing zero assignments is noise. */}
          {dueAssignments.length === 0 && (assignments.length === 0
            ? <div className="task-row"><span className="task-check"><ClipboardCheck size={13} /></span><div><strong>No assignments yet</strong><small>Your instructors haven’t published any assignments for your courses</small></div></div>
            : <div className="task-row"><span className="task-check done"><Check size={13} /></span><div><strong>All caught up</strong><small>You’ve submitted everything that’s due</small></div></div>)}
          {dueAssignments.slice(0, 3).map((assignment) => <div className="task-row" key={assignment._id}><span className="task-check late"><Check size={13} /></span><div><strong>{assignment.title}</strong><small>{assignment.courseTitle}</small></div><span className="task-state late">{dueLabel(assignment.dueAt)}</span><ChevronRight size={18} /></div>)}
        </section>
      </section>
      <section className="side-stack">
        <article className="event-card">
          <div className="card-header"><div><p className="eyebrow">COMING UP</p><h2>Learning calendar</h2></div><Link to="/calendar"><CalendarDays size={18} /></Link></div>
          {nextEvent
            ? <div className="event-main"><span className="event-date"><strong>{new Date(nextEvent.startsAt).getDate()}</strong>{new Date(nextEvent.startsAt).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span><div><small>{nextEvent.eventType.replace('_', ' ').toUpperCase()}</small><h3>{nextEvent.title}</h3><p><Clock3 size={14} /> {new Date(nextEvent.startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p></div></div>
            : <div className="card-empty"><CalendarDays size={20} /><strong>No upcoming events</strong><p>Live reviews and deadlines will appear here once they’re scheduled.</p></div>}
          {followingEvent && <div className="event-next"><span>{new Date(followingEvent.startsAt).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()} <b>{new Date(followingEvent.startsAt).getDate()}</b></span><p>{followingEvent.title} <small>{new Date(followingEvent.startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</small></p></div>}
          <Link to="/calendar" className="button button-ghost full">Open calendar <ArrowRight size={16} /></Link>
        </article>
        {/* The card used to disappear entirely with nothing to show, leaving a ragged column. */}
        <article className="notice-card"><span className="notice-icon"><Bell size={18} /></span>
          {latestNotification
            ? <div><small>{latestNotification.readAt ? 'NOTIFICATION' : 'NEW NOTIFICATION'}</small><h3>{latestNotification.title}</h3><p>{latestNotification.body}</p><Link to="/notifications">Read all notifications <ArrowRight size={14} /></Link></div>
            : <div><small>NOTIFICATIONS</small><h3>You’re all caught up</h3><p>Grades, announcements, and instructor replies will show up here.</p></div>}
        </article>
      </section>
    </div>
  </>
}

export default function DashboardPage({ role, user }) {
  if (role === 'admin') return <Navigate to="/admin/dashboard" replace />
  return role === 'learner' ? <LearnerDashboard user={user} /> : <InstructorDashboard user={user} />
}
