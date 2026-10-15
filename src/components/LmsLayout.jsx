import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useIsFetching, useIsMutating, useQuery } from '@tanstack/react-query'
import { io } from 'socket.io-client'
import { AlertTriangle, BarChart3, Bell, BookOpen, CalendarClock, CalendarDays, ChevronRight, ClipboardCheck, FileText, Flag, GraduationCap, LayoutDashboard, Library, LifeBuoy, LogOut, Mail, Megaphone, Menu, MessagesSquare, Newspaper, Receipt, RefreshCw, ScrollText, Search, Settings, ShieldCheck, Sparkles, Ticket, UserCheck, UserRound, Users, UsersRound, X } from 'lucide-react'
import { API_URL, avatarSrc } from '../lib/api.js'
import { authedFetch, getLastAuthReason, stopImpersonation } from '../lib/auth.js'
import { fetchCourses, fetchNotifications, fetchPresence, fetchStaffOverview, searchAcademy } from '../lib/lms.js'
import Brand from './Brand.jsx'
import LmsPageContent from './LmsPageContent.jsx'
import OnlineMembersPanel from './OnlineMembersPanel.jsx'
import { getLmsPage } from '../lib/lmsPages.js'

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard' },
  { label: 'Modules catalog', icon: BookOpen, to: '/catalog' },
  { label: 'Assignments', icon: ClipboardCheck, to: '/assignments' },
  { label: 'Announcements', icon: Megaphone, to: '/announcements' },
  { label: 'Discussions', icon: MessagesSquare, to: '/forums' },
  { label: 'Calendar', icon: CalendarDays, to: '/calendar' },
  { label: 'Notifications', icon: Bell, to: '/notifications', badgeKey: 'notifications' },
  { label: 'Statement of Account', icon: Receipt, to: '/statement' },
]

// Instructors teach across every course, so their nav leads with the teaching workspace
// (authoring, grading, roster) rather than the learner coursework nav.
const instructorNavItems = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard' },
  { label: 'Course builder', icon: BookOpen, to: '/builder' },
  { label: 'Submissions', icon: ClipboardCheck, to: '/submissions', badgeKey: 'grading' },
  { label: 'Student roster', icon: Users, to: '/roster' },
  { label: 'Attendance', icon: UserCheck, to: '/attendance' },
  { label: 'Enrollment Documents', icon: FileText, to: '/enrollment-documents' },
  { label: 'Announcements', icon: Megaphone, to: '/announcements' },
  { label: 'Discussions', icon: MessagesSquare, to: '/forums' },
  { label: 'Calendar', icon: CalendarDays, to: '/calendar' },
  { label: 'Notifications', icon: Bell, to: '/notifications', badgeKey: 'notifications' },
  { label: 'Recognition', icon: Sparkles, to: '/recognition' },
]

// Administrators get a dedicated console organized into logical operational domains
// with clear visual hierarchy, scannability, and instant access to all core modules.
const adminNavSections = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, to: '/admin/dashboard' },
      { label: 'Global Analytics', icon: BarChart3, to: '/admin/analytics' },
    ],
  },
  {
    title: 'Academics & Admissions',
    items: [
      { label: 'User Management', icon: Users, to: '/admin/users' },
      { label: 'Course Catalog & Pricing', icon: BookOpen, to: '/admin/courses' },
      { label: 'Enrollment Management', icon: GraduationCap, to: '/admin/enrollments', badgeKey: 'operations' },
      { label: 'Enrollment Documents', icon: FileText, to: '/enrollment-documents' },
      { label: 'Webinars & Special Courses', icon: CalendarClock, to: '/admin/webinars' },
      { label: 'Content Library', icon: Library, to: '/admin/content' },
    ],
  },
  {
    title: 'Communications',
    items: [
      { label: 'Announcements', icon: Megaphone, to: '/admin/announcements' },
      { label: 'Discussions', icon: MessagesSquare, to: '/forums' },
      { label: 'Email Automation', icon: Mail, to: '/admin/email-automation' },
      { label: 'Blog', icon: Newspaper, to: '/admin/blog' },
    ],
  },
  {
    title: 'Finance & Operations',
    items: [
      { label: 'Billing & Payments', icon: Receipt, to: '/admin/billing' },
      { label: 'Vouchers & Discounts', icon: Ticket, to: '/admin/vouchers' },
    ],
  },
  {
    title: 'Governance & Support',
    items: [
      { label: 'Roles & Permissions', icon: ShieldCheck, to: '/admin/roles' },
      { label: 'Audit Logs', icon: ScrollText, to: '/admin/audit' },
      { label: 'Reports', icon: Flag, to: '/admin/reports' },
      { label: 'Support / Helpdesk', icon: LifeBuoy, to: '/admin/support' },
    ],
  },
]

const pageTitles = {
  dashboard: 'Dashboard',
  catalog: 'Modules catalog',
  assignments: 'Assignments',
  calendar: 'Learning calendar',
  notifications: 'Notifications',
  forums: 'Discussions',
}

function usePresence(user) {
  const [members, setMembers] = useState([])
  useEffect(() => {
    if (!user) return undefined
    let cancelled = false
    fetchPresence().then((list) => { if (!cancelled) setMembers(list) }).catch(() => {})
    const socket = io(API_URL, { autoConnect: false, transports: ['websocket'] })
    const profile = { id: user.id, name: user.name, role: user.role, avatarUrl: user.avatarUrl }
    const beat = () => socket.emit('presence:heartbeat', profile)
    socket.on('connect', beat)
    socket.on('presence:changed', (list) => { if (!cancelled) setMembers(list) })
    socket.connect()
    const interval = window.setInterval(beat, 30_000)
    return () => { cancelled = true; window.clearInterval(interval); socket.disconnect() }
  }, [user])
  return members
}

function useNavBadges(user) {
  const isStaff = user?.role === 'instructor' || user?.role === 'admin'
  const { data: notifications = [] } = useQuery({ queryKey: ['nav-notifications', user?.id], queryFn: fetchNotifications, enabled: Boolean(user) })
  // Only admin's "Enrollment Management" nav item still uses this badge — instructors lost their
  // own enrollment-review page, so there's no reason to fetch this on their behalf anymore.
  const { data: pendingEnrollments = 0 } = useQuery({
    queryKey: ['nav-pending-enrollments'],
    queryFn: async () => {
      const response = await authedFetch('/api/staff/enrollments')
      if (!response.ok) return 0
      const rows = await response.json()
      return rows.filter((row) => row.status === 'paid_approval_pending').length
    },
    enabled: Boolean(user && user.role === 'admin'),
  })
  const { data: overview } = useQuery({ queryKey: ['staff-overview'], queryFn: fetchStaffOverview, enabled: Boolean(user && isStaff) })
  return {
    notifications: notifications.filter((notification) => !notification.readAt).length,
    operations: pendingEnrollments,
    grading: overview?.pendingGrading ?? 0,
  }
}

function HeaderSearch() {
  const navigate = useNavigate()
  const boxRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(term.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [term])
  const { data, isFetching } = useQuery({ queryKey: ['search', debounced], queryFn: () => searchAcademy(debounced), enabled: debounced.length >= 2 })
  useEffect(() => {
    const onClickAway = (event) => { if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [])
  const go = (to) => { setOpen(false); setTerm(''); navigate(to) }
  const groups = data ? [
    { label: 'Courses', icon: BookOpen, items: data.courses },
    { label: 'Announcements', icon: Megaphone, items: data.announcements },
    { label: 'People', icon: Users, items: data.users },
  ].filter((group) => group.items?.length) : []

  return <div className="header-search" ref={boxRef}>
    <button type="button" className="header-icon" aria-label="Search" onClick={() => setOpen((current) => !current)}><Search size={19} /></button>
    {open && <div className="header-search-panel">
      <input autoFocus type="search" placeholder="Search courses, announcements, people…" value={term} onChange={(event) => setTerm(event.target.value)} />
      {debounced.length >= 2 && isFetching && <p className="header-search-note">Searching…</p>}
      {debounced.length >= 2 && !isFetching && groups.length === 0 && <p className="header-search-note">No results for “{debounced}”.</p>}
      {groups.map((group) => <div className="header-search-group" key={group.label}>
        <small><group.icon size={12} /> {group.label}</small>
        {group.items.map((item) => <button type="button" key={item.id} onClick={() => go(item.to)}><strong>{item.title}</strong>{item.subtitle && <span>{item.subtitle}</span>}</button>)}
      </div>)}
    </div>}
  </div>
}

// Per-page spinners only cover a page's *first* load. Once data is cached, a refetch or a save
// leaves the screen looking idle — misleading against a hosted API that can stall for tens of
// seconds. This thin bar is the catch-all: any in-flight query or mutation, anywhere, shows it.
function ActivityBar() {
  const busy = useIsFetching() + useIsMutating() > 0
  if (!busy) return null
  return <div className="lms-activity-bar" role="status" aria-label="Loading" />
}

function initialsOf(name) {
  if (!name) return 'U'
  return name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
}

export default function LmsLayout({ user, authReady, authStatus = 'loading', authError = null, onRetryAuth, onSignOut, onUserUpdate }) {
  const [navOpen, setNavOpen] = useState(false)
  const [onlinePanelOpen, setOnlinePanelOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const page = location.pathname.split('/')[1] || 'dashboard'
  const title = pageTitles[page] ?? getLmsPage(location.pathname)?.label ?? `${page.charAt(0).toUpperCase()}${page.slice(1)}`
  const members = usePresence(user)
  const badges = useNavBadges(user)
  // Learner access is pathway-scoped (see learnerVisibleCourseFilter) — the course(s) /api/courses
  // returns for a learner *are* the program(s) they're enrolled in, so no separate lookup is needed.
  const { data: learnerCourses = [] } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses, enabled: Boolean(user && user.role === 'learner') })

  // 1. Loading state (genuine check in-flight)
  if (!authReady || authStatus === 'loading') {
    return <div className="lms-auth-loading">
      <div className="lms-auth-loading-card">
        <span className="spinner" />
        <p>Verifying your session…</p>
        <button
          type="button"
          className="lms-auth-loading-btn"
          onClick={() => {
            navigate(`/auth?redirect=${encodeURIComponent(location.pathname + location.search)}&reason=logged_out`, { replace: true })
          }}
        >
          Go to Sign In
        </button>
      </div>
    </div>
  }

  // 2. Recoverable error state (server down, 5xx, or network failure while having a session)
  if (authStatus === 'error' && !user) {
    return <div className="lms-auth-loading">
      <div className="lms-auth-error-card">
        <AlertTriangle size={36} color="#c0392b" style={{ marginBottom: 8 }} />
        <h3>Unable to Connect to Server</h3>
        <p>
          {authError || 'We could not reach the Tree Academy service to verify your credentials. The server may be starting up or your connection was interrupted.'}
        </p>
        <div className="lms-auth-error-actions">
          {onRetryAuth && (
            <button type="button" className="button button-primary button-compact" onClick={onRetryAuth}>
              <RefreshCw size={14} /> Retry Connection
            </button>
          )}
          <button
            type="button"
            className="button button-ghost button-compact"
            onClick={() => {
              navigate(`/auth?redirect=${encodeURIComponent(location.pathname + location.search)}&reason=logged_out`, { replace: true })
            }}
          >
            Go to Sign In
          </button>
          <Link to="/" className="button button-ghost button-compact">
            Home
          </Link>
        </div>
      </div>
    </div>
  }

  // 3. Unauthenticated state (user logged out or session expired)
  if (!user) {
    const target = location.pathname + location.search
    const reason = getLastAuthReason() || 'logged_out'
    return <Navigate to={`/auth?redirect=${encodeURIComponent(target)}&reason=${reason}`} replace state={{ from: location }} />
  }

  const role = user.role
  const initials = initialsOf(user.name)
  const programLabel = learnerCourses.length ? learnerCourses.map((course) => course.title).join(' & ') : 'All-access learner'
  const signOut = async () => { await onSignOut(); navigate('/') }
  const exitImpersonation = async () => { try { await stopImpersonation() } catch { /* fall through to reload */ } window.location.assign('/admin/users') }

  return <div className="lms-page">
    <ActivityBar />
    <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
      <div className="sidebar-head"><Brand light /><button onClick={() => setNavOpen(false)} className="sidebar-close" aria-label="Close navigation"><X /></button></div>
      <div className="workspace-label"><span className="workspace-avatar" style={user.avatarUrl ? { backgroundImage: `url(${avatarSrc(user.avatarUrl)})` } : undefined}>{!user.avatarUrl && initials}</span><span><strong>{user.name}</strong><small>{role === 'learner' ? programLabel : role.charAt(0).toUpperCase() + role.slice(1)}</small></span></div>
      <nav className="lms-nav">
        {role === 'admin'
          ? adminNavSections.map((section) => (
            <div className="lms-nav-group" key={section.title}>
              <div className="lms-nav-section-title">{section.title}</div>
              {section.items.map((item) => (
                <NavLink key={item.to} to={item.to} onClick={() => setNavOpen(false)}>
                  <item.icon size={18} />
                  <span>{item.label}</span>
                  {item.badgeKey && badges[item.badgeKey] > 0 && <b className="gold-badge">{badges[item.badgeKey]}</b>}
                </NavLink>
              ))}
            </div>
          ))
          : role === 'instructor'
          ? instructorNavItems.map((item) => <NavLink key={item.to} to={item.to} onClick={() => setNavOpen(false)}><item.icon size={19} /><span>{item.label}</span>{item.badgeKey && badges[item.badgeKey] > 0 && <b className="gold-badge">{badges[item.badgeKey]}</b>}</NavLink>)
          : navItems.map((item) => <NavLink key={item.to} to={item.to} onClick={() => setNavOpen(false)}><item.icon size={19} /><span>{item.label}</span>{item.badgeKey && badges[item.badgeKey] > 0 && <b>{badges[item.badgeKey]}</b>}</NavLink>)}
      </nav>
      {/* Learners and instructors have one destination — the profile page absorbed Settings, so
          showing both would be two links to the same screen. Admins have no learner profile. */}
      <div className="sidebar-bottom">{role === 'admin'
        ? <NavLink to="/settings"><Settings size={19} /> <span>Settings</span></NavLink>
        : <NavLink to="/profile"><UserRound size={19} /> <span>Profile &amp; settings</span></NavLink>}<button type="button" className="sidebar-signout" onClick={signOut}><LogOut size={19} /> <span>Sign out</span></button></div>
    </aside>
    <div className={`sidebar-backdrop ${navOpen ? 'show' : ''}`} onClick={() => setNavOpen(false)} />
    <main className="lms-main">{user.impersonating && <div className="impersonation-bar"><span><UserRound size={15} /> Viewing as <strong>{user.name}</strong>{user.impersonatorName ? ` — signed in as ${user.impersonatorName}` : ''}</span><button type="button" onClick={exitImpersonation}>Exit impersonation</button></div>}<header className="lms-header"><button className="lms-menu" onClick={() => setNavOpen(true)} aria-label="Open navigation"><Menu /></button><div className="breadcrumbs"><span>Tree Academy</span><ChevronRight size={15} /><strong>{title}</strong></div><div className="header-tools"><HeaderSearch /><NavLink to="/notifications" className="header-icon notification-dot" aria-label="Notifications" data-has-unread={badges.notifications > 0}><Bell size={19} /></NavLink><button className="member-trigger" onClick={() => setOnlinePanelOpen(true)} aria-expanded={onlinePanelOpen} aria-controls="online-members-title"><i className="online-live-dot" /><UsersRound size={16} /><span><b>{members.length}</b> Online</span></button></div></header><section className="page-content"><LmsPageContent page={page} pathname={location.pathname} role={role} user={user} onUserUpdate={onUserUpdate} /></section></main>
    <OnlineMembersPanel open={onlinePanelOpen} onOpenChange={setOnlinePanelOpen} members={members} currentUserId={user.id} />
  </div>
}
