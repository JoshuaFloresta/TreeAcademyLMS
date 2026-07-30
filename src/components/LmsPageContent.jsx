import { Navigate } from 'react-router-dom'
import SettingsPage from '../pages/lms/SettingsPage.jsx'
import AssignmentDetailPage from '../pages/lms/AssignmentDetailPage.jsx'
import ForumsPage from '../pages/lms/ForumsPage.jsx'
import CourseBuilderPage from '../pages/lms/instructor/CourseBuilderPage.jsx'
import AssignmentEditorPage from '../pages/lms/instructor/AssignmentEditorPage.jsx'
import QuizEditorPage from '../pages/lms/instructor/QuizEditorPage.jsx'
import SubmissionReviewPage from '../pages/lms/instructor/SubmissionReviewPage.jsx'
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

export default function LmsPageContent({ page, pathname, role, user, onUserUpdate }) {
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

  const currentPage = getLmsPage(pathname)
  const Page = currentPage?.component

  if (Page) return <Page role={role} page={page} user={user} onUserUpdate={onUserUpdate} />
  return <SettingsPage page={page} user={user} onUserUpdate={onUserUpdate} />
}
