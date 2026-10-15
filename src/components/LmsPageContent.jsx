import { Navigate } from 'react-router-dom'
import SettingsPage from '../pages/lms/SettingsPage.jsx'
import AssignmentDetailPage from '../pages/lms/AssignmentDetailPage.jsx'
import ForumsPage from '../pages/lms/ForumsPage.jsx'
import AnnouncementsPage from '../pages/lms/AnnouncementsPage.jsx'
import AdminAnnouncementsPage from '../pages/lms/admin/AdminAnnouncementsPage.jsx'
import CourseBuilderPage from '../pages/lms/instructor/CourseBuilderPage.jsx'
import AssignmentEditorPage from '../pages/lms/instructor/AssignmentEditorPage.jsx'
import QuizEditorPage from '../pages/lms/instructor/QuizEditorPage.jsx'
import SubmissionReviewPage from '../pages/lms/instructor/SubmissionReviewPage.jsx'
import AccessDenied from './AccessDenied.jsx'
import { getLmsPage } from '../lib/lmsPages.js'

const assignmentDetailPattern = /^\/assignments\/([^/]+)$/
// Two kinds of submitted work live under one review page; the kind is in the path so the page can
// be linked to directly (from the feed, or from a notification) without extra lookup.
const submissionReviewPattern = /^\/submissions\/(assignment|quiz)\/([^/]+)$/
const builderAssignmentPattern = /^\/builder\/assignments\/([^/]+)$/
const builderQuizPattern = /^\/builder\/quizzes\/([^/]+)$/
// A discussion thread gets its own URL so "Share" on the thread page can hand out a real
// deep link, rather than everyone landing back on the undifferentiated /forums list.
const forumThreadPattern = /^\/forums\/([^/]+)$/
const announcementDetailPattern = /^\/announcements\/([^/]+)$/
const adminAnnouncementDetailPattern = /^\/admin\/announcements\/([^/]+)$/

export default function LmsPageContent({ page, pathname, role, user, onUserUpdate }) {
  // Admin-only route guard
  if (pathname.startsWith('/admin') && role !== 'admin') {
    return <AccessDenied role={role} requiredRoles={['Admin']} />
  }

  // Instructor/Admin teaching tools route guard
  const isTeachingPath = pathname === '/builder' || pathname.startsWith('/builder/') || pathname === '/submissions' || pathname.startsWith('/submissions/')
  if (isTeachingPath && !['instructor', 'admin'].includes(role)) {
    return <AccessDenied role={role} requiredRoles={['Instructor', 'Admin']} />
  }

  const assignmentMatch = pathname.match(assignmentDetailPattern)
  if (assignmentMatch) return <AssignmentDetailPage role={role} assignmentId={assignmentMatch[1]} />

  const builderAssignmentMatch = pathname.match(builderAssignmentPattern)
  if (builderAssignmentMatch) return <AssignmentEditorPage role={role} assignmentId={builderAssignmentMatch[1] === 'new' ? undefined : builderAssignmentMatch[1]} />

  const builderQuizMatch = pathname.match(builderQuizPattern)
  if (builderQuizMatch) return <QuizEditorPage role={role} quizId={builderQuizMatch[1] === 'new' ? undefined : builderQuizMatch[1]} />

  if (pathname === '/builder') return <CourseBuilderPage role={role} />
  // The Gradebook became Submissions. Notifications already sent to learners and instructors carry
  // the old path, so it has to keep resolving rather than dropping them on a blank page.
  if (pathname === '/gradebook') return <Navigate to="/submissions" replace />

  const reviewMatch = pathname.match(submissionReviewPattern)
  if (reviewMatch) return <SubmissionReviewPage role={role} kind={reviewMatch[1]} id={reviewMatch[2]} />

  const forumThreadMatch = pathname.match(forumThreadPattern)
  if (forumThreadMatch) return <ForumsPage role={role} user={user} initialThreadId={forumThreadMatch[1]} />

  const announcementMatch = pathname.match(announcementDetailPattern)
  if (announcementMatch) return <AnnouncementsPage role={role} user={user} announcementId={announcementMatch[1]} />

  const adminAnnouncementMatch = pathname.match(adminAnnouncementDetailPattern)
  if (adminAnnouncementMatch) return <AdminAnnouncementsPage role={role} user={user} announcementId={adminAnnouncementMatch[1]} />

  const currentPage = getLmsPage(pathname)
  if (currentPage?.roles && !currentPage.roles.includes(role)) {
    return <AccessDenied role={role} requiredRoles={currentPage.roles} />
  }

  const Page = currentPage?.component

  if (Page) return <Page role={role} page={page} user={user} onUserUpdate={onUserUpdate} />
  return <SettingsPage page={page} user={user} onUserUpdate={onUserUpdate} />
}
