import { useEffect, useRef, useState } from 'react'
import { Navigate, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { io } from 'socket.io-client'
import { BarChart3, Bell, BookOpen, CalendarClock, CalendarDays, ChevronDown, ChevronRight, ClipboardCheck, Flag, GraduationCap, LayoutDashboard, Library, LifeBuoy, LogOut, Mail, Megaphone, Menu, MessagesSquare, MoreHorizontal, ScrollText, Search, Settings, ShieldCheck, Sparkles, UserRound, Users, UsersRound, X } from 'lucide-react'
import { API_URL, avatarSrc } from '../lib/api.js'
import { authedFetch, stopImpersonation } from '../lib/auth.js'
import { fetchAssignments, fetchNotifications, fetchPresence, fetchStaffOverview, searchAcademy } from '../lib/lms.js'
import Brand from './Brand.jsx'
import LmsPageContent from './LmsPageContent.jsx'
import OnlineMembersPanel from './OnlineMembersPanel.jsx'
import { getLmsPage } from '../lib/lmsPages.js'

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard' },
  { label: 'Modules catalog', icon: BookOpen, to: '/catalog' },
  { label: 'Assignments', icon: ClipboardCheck, to: '/assignments', badgeKey: 'assignments' },
  { label: 'Announcements', icon: Megaphone, to: '/announcements' },
  { label: 'Discussions', icon: MessagesSquare, to: '/forums' },
  { label: 'Calendar', icon: CalendarDays, to: '/calendar' },
  { label: 'Notifications', icon: Bell, to: '/notifications', badgeKey: 'notifications' },
]

// Instructors teach across every course, so their nav leads with the teaching workspace
// (authoring, grading, roster) rather than the learner coursework nav.
const instructorNavItems = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard' },
  { label: 'Course builder', icon: BookOpen, to: '/builder' },
  { label: 'Gradebook', icon: ClipboardCheck, to: '/gradebook', badgeKey: 'grading' },
  { label: 'Student roster', icon: Users, to: '/roster' },
  { label: 'Course analytics', icon: BarChart3, to: '/insights' },
  { label: 'Announcements', icon: Megaphone, to: '/announcements' },
  { label: 'Discussions', icon: MessagesSquare, to: '/forums' },
  { label: 'Calendar', icon: CalendarDays, to: '/calendar' },
  { label: 'Notifications', icon: Bell, to: '/notifications', badgeKey: 'notifications' },
  { label: 'Operations', icon: ShieldCheck, to: '/operations', badgeKey: 'operations' },
  { label: 'Recognition', icon: Sparkles, to: '/recognition' },
]

// Administrators get a dedicated console — only platform-management destinations, none of the
// learner/instructor coursework nav. The list has grown past what's comfortable in one glance,
// so only the most-used destinations show by default; the rest sit behind a "More" toggle.
const adminNavItems = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/admin/dashboard', primary: true },
  { label: 'User Management', icon: Users, to: '/admin/users', primary: true },
  { label: 'Course Catalog & Pricing', icon: BookOpen, to: '/admin/courses', primary: true },
  { label: 'Enrollment Management', icon: GraduationCap, to: '/admin/enrollments', badgeKey: 'operations', primary: true },
  { label: 'Global Analytics', icon: BarChart3, to: '/admin/analytics', primary: true },
  { label: 'Roles & Permissions', icon: ShieldCheck, to: '/admin/roles' },
  { label: 'Audit Logs', icon: ScrollText, to: '/admin/audit' },
  { label: 'Content Library', icon: Library, to: '/admin/content' },
  { label: 'Support / Helpdesk', icon: LifeBuoy, to: '/admin/support' },
  { label: 'Reports', icon: Flag, to: '/admin/reports' },
  { label: 'Webinars & Special Courses', icon: CalendarClock, to: '/admin/webinars' },
  { label: 'Email Automation', icon: Mail, to: '/admin/email-automation' },
]

const pageTitles = {
  dashboard: 'Dashboard',
  catalog: 'Modules catalog',
  assignments: 'Assignments',
  calendar: 'Learning calendar',
  notifications: 'Notifications',
  operations: 'Academy operations',
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
  const isLearner = user?.role === 'learner'
  const isStaff = user?.role === 'instructor' || user?.role === 'admin'
  const { data: assignments = [] } = useQuery({ queryKey: ['nav-assignments', user?.id], queryFn: fetchAssignments, enabled: isLearner })
  const { data: notifications = [] } = useQuery({ queryKey: ['nav-notifications', user?.id], queryFn: fetchNotifications, enabled: Boolean(user) })
  const { data: pendingEnrollments = 0 } = useQuery({
    queryKey: ['nav-pending-enrollments'],
    queryFn: async () => {
      const response = await authedFetch('/api/staff/enrollments')
      if (!response.ok) return 0
      const rows = await response.json()
      return rows.filter((row) => row.status === 'paid_approval_pending').length
    },
    enabled: isStaff,
  })
  const { data: overview } = useQuery({ queryKey: ['staff-overview'], queryFn: fetchStaffOverview, enabled: isStaff })
  return {
    assignments: isLearner ? assignments.filter((assignment) => !assignment.mySubmission).length : 0,
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

function initialsOf(name) {
  if (!name) return 'U'
  return name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
}

export default function LmsLayout({ user, authReady, onSignOut, onUserUpdate }) {
  const [navOpen, setNavOpen] = useState(false)
  const [onlinePanelOpen, setOnlinePanelOpen] = useState(false)
  const [adminNavExpanded, setAdminNavExpanded] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const page = location.pathname.split('/')[1] || 'dashboard'
  const title = pageTitles[page] ?? getLmsPage(location.pathname)?.label ?? `${page.charAt(0).toUpperCase()}${page.slice(1)}`
  const members = usePresence(user)
  const badges = useNavBadges(user)
  // If the active page lives behind the "More" toggle, keep it expanded so the highlighted
  // link stays visible instead of hiding on navigation.
  const onSecondaryAdminPage = adminNavItems.some((item) => !item.primary && item.to === location.pathname)
  const showAllAdminItems = adminNavExpanded || onSecondaryAdminPage

  if (!authReady) return <div className="lms-auth-loading"><span className="spinner" /></div>
  if (!user) return <Navigate to="/auth" replace />

  const role = user.role
  const initials = initialsOf(user.name)
  const signOut = async () => { await onSignOut(); navigate('/') }
  const exitImpersonation = async () => { try { await stopImpersonation() } catch { /* fall through to reload */ } window.location.assign('/admin/users') }

  return <div className="lms-page">
    <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
      <div className="sidebar-head"><Brand light /><button onClick={() => setNavOpen(false)} className="sidebar-close" aria-label="Close navigation"><X /></button></div>
      <div className="workspace-label"><span className="workspace-avatar" style={user.avatarUrl ? { backgroundImage: `url(${avatarSrc(user.avatarUrl)})` } : undefined}>{!user.avatarUrl && initials}</span><span><strong>{user.name}</strong><small>{role === 'learner' ? 'All-access learner' : role.charAt(0).toUpperCase() + role.slice(1)}</small></span></div>
      <nav className="lms-nav">
        {role === 'admin'
          ? <>
            {adminNavItems.filter((item) => item.primary || showAllAdminItems).map((item) => <NavLink key={item.to} to={item.to} onClick={() => setNavOpen(false)}><item.icon size={19} /><span>{item.label}</span>{item.badgeKey && badges[item.badgeKey] > 0 && <b className="gold-badge">{badges[item.badgeKey]}</b>}</NavLink>)}
            <button type="button" className="lms-nav-more" onClick={() => setAdminNavExpanded((current) => !current)}>
              {showAllAdminItems ? <MoreHorizontal size={19} /> : <ChevronDown size={19} />}
              <span>{showAllAdminItems ? 'Show less' : `More (${adminNavItems.filter((item) => !item.primary).length})`}</span>
            </button>
          </>
          : role === 'instructor'
          ? instructorNavItems.map((item) => <NavLink key={item.to} to={item.to} onClick={() => setNavOpen(false)}><item.icon size={19} /><span>{item.label}</span>{item.badgeKey && badges[item.badgeKey] > 0 && <b className="gold-badge">{badges[item.badgeKey]}</b>}</NavLink>)
          : navItems.map((item) => <NavLink key={item.to} to={item.to} onClick={() => setNavOpen(false)}><item.icon size={19} /><span>{item.label}</span>{item.badgeKey && badges[item.badgeKey] > 0 && <b>{badges[item.badgeKey]}</b>}</NavLink>)}
      </nav>
      <div className="sidebar-bottom"><NavLink to="/settings"><Settings size={19} /> <span>Settings</span></NavLink>{role !== 'admin' && <NavLink to="/profile"><UserRound size={19} /> <span>My profile</span></NavLink>}<button type="button" className="sidebar-signout" onClick={signOut}><LogOut size={19} /> <span>Sign out</span></button></div>
    </aside>
    <div className={`sidebar-backdrop ${navOpen ? 'show' : ''}`} onClick={() => setNavOpen(false)} />
    <main className="lms-main">{user.impersonating && <div className="impersonation-bar"><span><UserRound size={15} /> Viewing as <strong>{user.name}</strong>{user.impersonatorName ? ` — signed in as ${user.impersonatorName}` : ''}</span><button type="button" onClick={exitImpersonation}>Exit impersonation</button></div>}<header className="lms-header"><button className="lms-menu" onClick={() => setNavOpen(true)} aria-label="Open navigation"><Menu /></button><div className="breadcrumbs"><span>Tree Academy</span><ChevronRight size={15} /><strong>{title}</strong></div><div className="header-tools"><HeaderSearch /><NavLink to="/notifications" className="header-icon notification-dot" aria-label="Notifications" data-has-unread={badges.notifications > 0}><Bell size={19} /></NavLink><button className="member-trigger" onClick={() => setOnlinePanelOpen(true)} aria-expanded={onlinePanelOpen} aria-controls="online-members-title"><i className="online-live-dot" /><UsersRound size={16} /><span><b>{members.length}</b> Online</span></button></div></header><section className="page-content"><LmsPageContent page={page} pathname={location.pathname} role={role} user={user} onUserUpdate={onUserUpdate} /></section></main>
    <OnlineMembersPanel open={onlinePanelOpen} onOpenChange={setOnlinePanelOpen} members={members} currentUserId={user.id} />
  </div>
}
