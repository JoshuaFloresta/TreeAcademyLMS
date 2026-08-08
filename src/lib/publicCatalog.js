import { API_URL } from './api.js'

async function json(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? 'That request could not be completed. Please try again.')
  return data
}

// Unauthenticated landing-page data — pathway live stats and open webinars/special courses.
export const fetchPathwayStats = () => fetch(`${API_URL}/api/public/pathway-stats`).then((response) => (response.ok ? response.json() : {}))
export const fetchPublicWebinars = () => fetch(`${API_URL}/api/public/webinars`).then((response) => (response.ok ? response.json() : []))
export const registerForWebinar = (id, payload) => fetch(`${API_URL}/api/public/webinars/${id}/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
}).then(json)

// Blog — staff-authored posts plus the (optional) external real-estate news feed. Both fail soft
// to an empty list/unconfigured state rather than throwing, since a blog page reads fine empty.
export const fetchBlogPosts = () => fetch(`${API_URL}/api/public/blog`).then((response) => (response.ok ? response.json() : []))
export const fetchBlogPost = (slug) => fetch(`${API_URL}/api/public/blog/${slug}`).then(json)
export const fetchRealEstateNews = () => fetch(`${API_URL}/api/public/real-estate-news`).then((response) => (response.ok ? response.json() : { configured: false, articles: [] }))
