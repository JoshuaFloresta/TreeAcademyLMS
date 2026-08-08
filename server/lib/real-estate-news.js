import { config } from '../config.js'

// Cached in memory (not Mongo) — this is a read-through cache of someone else's API, not data this
// app owns, and losing it on restart just means the next request re-fetches. A single shared cache
// across all visitors, not per-request, is what keeps this within a free-tier daily quota.
const CACHE_TTL_MS = 60 * 60 * 1000
let cache = null // { fetchedAt, articles }
let inFlight = null // dedupes concurrent cache-miss requests into one upstream call

function isFresh() {
  return cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS
}

// GNews v4 search response shape: { articles: [{ title, description, url, image, publishedAt,
// source: { name } }] }. Mapped to a small, stable shape so the frontend and any future provider
// swap never need to know GNews's own field names.
function normalizeGNewsArticle(article) {
  return {
    title: article.title,
    description: article.description ?? '',
    url: article.url,
    imageUrl: article.image ?? null,
    publishedAt: article.publishedAt,
    sourceName: article.source?.name ?? 'News',
  }
}

async function fetchFromGNews() {
  const url = new URL('https://gnews.io/api/v4/search')
  url.searchParams.set('q', config.newsApi.query)
  url.searchParams.set('lang', 'en')
  url.searchParams.set('max', '10')
  url.searchParams.set('apikey', config.newsApi.apiKey)
  const response = await fetch(url)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.errors?.[0] ?? `GNews request failed (${response.status})`)
  return (data.articles ?? []).map(normalizeGNewsArticle)
}

// Returns { configured, articles }. `configured: false` (no NEWS_API_KEY set) is the expected
// state for anyone who hasn't signed up for a provider yet — the route/page treat it as "nothing
// to show" rather than an error. A genuine fetch failure serves the last good cache if there is
// one, so one upstream hiccup doesn't blank out the whole section.
export async function fetchRealEstateNews() {
  if (!config.newsApi.apiKey) return { configured: false, articles: [] }
  if (isFresh()) return { configured: true, articles: cache.articles }
  inFlight ??= fetchFromGNews()
    .then((articles) => { cache = { fetchedAt: Date.now(), articles }; return articles })
    .catch((error) => {
      console.error('real-estate-news fetch failed:', error.message)
      if (cache) return cache.articles // serve stale rather than nothing
      throw error
    })
    .finally(() => { inFlight = null })
  const articles = await inFlight
  return { configured: true, articles }
}
