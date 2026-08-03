const roleValues = ['learner', 'instructor', 'admin']

const builtInPageOptions = {
  catalog: { label: 'Modules catalog' },
  // Reachable only via /assignments/:id (special-cased in LmsPageContent.jsx) — not a standalone
  // nav destination, so it's excluded from every role's page listing.
  'assignment-detail': { roles: [] },
  recognition: { roles: ['instructor', 'admin'] },
  'statement-of-account': { label: 'Statement of Account', roles: ['learner'], to: '/statement' },
  'course-builder': { label: 'Course builder', roles: ['instructor', 'admin'], to: '/builder' },
  submissions: { label: 'Submissions', roles: ['instructor', 'admin'], to: '/submissions' },
  roster: { label: 'Student roster', roles: ['instructor', 'admin'], to: '/roster' },
  attendance: { label: 'Attendance', roles: ['instructor', 'admin'], to: '/attendance' },
  'enrollment-documents': { label: 'Enrollment Documents', roles: ['instructor', 'admin'], to: '/enrollment-documents' },
  // Retired from the nav — admins get the same numbers on Global Analytics. The page file is kept
  // so the route still resolves for anyone holding an old link.
  'course-analytics': { label: 'Course analytics', roles: [], to: '/insights' },
  forums: { label: 'Discussions' },
  'admin-dashboard': { label: 'Dashboard', roles: ['admin'], to: '/admin/dashboard' },
  'admin-users': { label: 'User Management', roles: ['admin'], to: '/admin/users' },
  'admin-courses': { label: 'Course Catalog & Pricing', roles: ['admin'], to: '/admin/courses' },
  'admin-roles': { label: 'Roles & Permissions', roles: ['admin'], to: '/admin/roles' },
  'admin-enrollments': { label: 'Enrollment Management', roles: ['admin'], to: '/admin/enrollments' },
  'admin-billing': { label: 'Billing & Payments', roles: ['admin'], to: '/admin/billing' },
  'admin-audit': { label: 'Audit Logs', roles: ['admin'], to: '/admin/audit' },
  'admin-content': { label: 'Content Library', roles: ['admin'], to: '/admin/content' },
  'admin-support': { label: 'Support / Helpdesk', roles: ['admin'], to: '/admin/support' },
  'admin-analytics': { label: 'Global Analytics', roles: ['admin'], to: '/admin/analytics' },
  'admin-reports': { label: 'Reports', roles: ['admin'], to: '/admin/reports' },
  'admin-webinars': { label: 'Special Courses & Webinars', roles: ['admin'], to: '/admin/webinars' },
  'admin-email-automation': { label: 'Email Automation', roles: ['admin'], to: '/admin/email-automation' },
}

const pageModules = import.meta.glob('../pages/lms/**/*.jsx', { eager: true })

function toKebabCase(value) {
  return value
    .replace(/Page$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase()
}

function toLabel(value) {
  return value
    .replace(/Page$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
}

export const lmsPages = Object.entries(pageModules)
  .map(([file, module]) => {
    const relativeFile = file.replace('../pages/lms/', '').replace(/\.jsx$/, '')
    const fileName = relativeFile.split('/').pop()
    const key = toKebabCase(fileName)
    const options = builtInPageOptions[key] ?? {}
    const generatedPath = `/${relativeFile.split('/').map(toKebabCase).join('/')}`

    return {
      component: module.default,
      key,
      label: options.label ?? toLabel(fileName),
      roles: options.roles ?? roleValues,
      to: options.to ?? generatedPath,
    }
  })
  .filter((page) => page.component)
  .sort((first, second) => first.label.localeCompare(second.label))

export function getLmsPage(pathname) {
  return lmsPages.find((page) => page.to === pathname)
}
