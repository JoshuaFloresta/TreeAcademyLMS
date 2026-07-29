import SettingsPage from '../pages/lms/SettingsPage.jsx'
import AssignmentDetailPage from '../pages/lms/AssignmentDetailPage.jsx'
import CourseBuilderPage from '../pages/lms/instructor/CourseBuilderPage.jsx'
import AssignmentEditorPage from '../pages/lms/instructor/AssignmentEditorPage.jsx'
import QuizEditorPage from '../pages/lms/instructor/QuizEditorPage.jsx'
import { getLmsPage } from '../lib/lmsPages.js'

const assignmentDetailPattern = /^\/assignments\/([^/]+)$/
const builderAssignmentPattern = /^\/builder\/assignments\/([^/]+)$/
const builderQuizPattern = /^\/builder\/quizzes\/([^/]+)$/

export default function LmsPageContent({ page, pathname, role, user, onUserUpdate }) {
  const assignmentMatch = pathname.match(assignmentDetailPattern)
  if (assignmentMatch) return <AssignmentDetailPage role={role} assignmentId={assignmentMatch[1]} />

  const builderAssignmentMatch = pathname.match(builderAssignmentPattern)
  if (builderAssignmentMatch) return <AssignmentEditorPage role={role} assignmentId={builderAssignmentMatch[1] === 'new' ? undefined : builderAssignmentMatch[1]} />

  const builderQuizMatch = pathname.match(builderQuizPattern)
  if (builderQuizMatch) return <QuizEditorPage role={role} quizId={builderQuizMatch[1] === 'new' ? undefined : builderQuizMatch[1]} />

  if (pathname === '/builder') return <CourseBuilderPage role={role} />

  const currentPage = getLmsPage(pathname)
  const Page = currentPage?.component

  if (Page) return <Page role={role} page={page} user={user} onUserUpdate={onUserUpdate} />
  return <SettingsPage page={page} user={user} onUserUpdate={onUserUpdate} />
}
