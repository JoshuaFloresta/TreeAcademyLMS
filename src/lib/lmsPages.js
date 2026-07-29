const roleValues = ['learner', 'instructor', 'admin']

const builtInPageOptions = {
  catalog: { label: 'Modules catalog' },
  // Reachable only via /assignments/:id (special-cased in LmsPageContent.jsx) — not a standalone
  // nav destination, so it's excluded from every role's page listing.
  'assignment-detail': { roles: [] },
  operations: { roles: ['instructor', 'admin'] },
  recognition: { roles: ['instructor', 'admin'] },
  'course-builder': { label: 'Course builder', roles: ['instructor', 'admin'], to: '/builder' },
  gradebook: { label: 'Gradebook', roles: ['instructor', 'admin'], to: '/gradebook' },
  roster: { label: 'Student roster', roles: ['instructor', 'admin'], to: '/roster' },
  'course-analytics': { label: 'Course analytics', roles: ['instructor', 'admin'], to: '/insights' },
  forums: { label: 'Discussions' },
  'admin-dashboard': { label: 'Dashboard', roles: ['admin'], to: '/admin/dashboard' },
  'admin-users': { label: 'User Management', roles: ['admin'], to: '/admin/users' },
  'admin-courses': { label: 'Course Catalog & Pricing', roles: ['admin'], to: '/admin/courses' },
  'admin-roles': { label: 'Roles & Permissions', roles: ['admin'], to: '/admin/roles' },
  'admin-enrollments': { label: 'Enrollment Management', roles: ['admin'], to: '/admin/enrollments' },
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
    const options = { ...builtInPageOptions[key], ...module.devPage }
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

const legacyPages = [{
  key: 'profile',
  label: 'My profile',
  roles: ['learner', 'instructor'],
  to: '/profile',
  component: null,
}]

const sharedDevPages = [
  { label: 'Landing', to: '/' },
  { label: 'Enrollment', to: '/enroll' },
  { label: 'Authentication', to: '/auth' },
]

export function getLmsPagesForRole(role) {
  return [...lmsPages, ...legacyPages].filter((page) => page.roles.includes(role))
}

export function getDevPagesForRole(role) {
  return [...sharedDevPages, ...getLmsPagesForRole(role)]
}

export function getLmsPage(pathname) {
  return lmsPages.find((page) => page.to === pathname)
}
