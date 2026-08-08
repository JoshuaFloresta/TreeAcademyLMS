import { config } from '../config.js'

// Cached in memory (not Mongo) — this is a read-through cache of someone else's API, not data this
// app owns, and losing it on restart just means the next request re-fetches. A single shared cache
// across all visitors, not per-request, is what keeps this within a free-tier daily quota. 2 hours
// (not 1) because more search terms (see config.newsApi.queries) means more GNews requests per
// refresh — 12 refreshes/day × up to ~8 queries stays comfortably under a ~100/day free-tier quota,
// where 24 refreshes/day would not. News doesn't need to be that fresh anyway.
const CACHE_TTL_MS = 2 * 60 * 60 * 1000
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function searchGNewsOnce(query) {
  const url = new URL('https://gnews.io/api/v4/search')
  url.searchParams.set('q', query)
  url.searchParams.set('lang', 'en')
  url.searchParams.set('max', '10') // GNews's free-tier ceiling per request, regardless of a higher value here
  url.searchParams.set('apikey', config.newsApi.apiKey)
  const response = await fetch(url)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.errors?.[0] ?? `GNews request failed (${response.status})`)
  return (data.articles ?? []).map(normalizeGNewsArticle)
}

// One retry after a short pause — the connection to gnews.io from this kind of environment
// occasionally drops a single request (a plain network-level timeout, not a GNews error response),
// while an immediate retry succeeds. Not applied to actual GNews error responses (rate limit, bad
// key, etc.) — those are real answers, not flukes, and retrying them just burns another request.
async function searchGNews(query) {
  try {
    return await searchGNewsOnce(query)
  } catch (error) {
    console.error(`real-estate-news query "${query}" failed once, retrying:`, error.message)
    await sleep(1500)
    return searchGNewsOnce(query)
  }
}

// Runs every configured search term and merges the results — one narrow phrase rarely returns
// enough articles to fill a 12-card grid, since GNews requires every word in `q` to match. Queries
// run one at a time, spaced apart (not Promise.all fired together), because GNews's own burst rate
// limit rejects requests that land too close together even well under the daily quota. Each query
// is independently best-effort: one failing (timeout, rate-limited, whatever) must not discard
// articles a different query already found, so a caught error just moves on to the next term
// rather than propagating. Deduped by URL (different phrasings commonly surface the same story)
// and sorted newest-first before being trimmed to config.newsApi.maxArticles.
async function fetchFromGNews() {
  const seen = new Map()
  let lastError = null
  for (const [index, query] of config.newsApi.queries.entries()) {
    if (seen.size >= config.newsApi.maxArticles) break
    if (index > 0) await sleep(1000)
    try {
      const articles = await searchGNews(query)
      for (const article of articles) if (!seen.has(article.url)) seen.set(article.url, article)
    } catch (error) {
      console.error(`real-estate-news query "${query}" failed:`, error.message)
      lastError = error
    }
  }
  // Only surface an error if EVERY query failed and there is nothing to show at all — a partial
  // result (some queries succeeded) is a good outcome, not a failure.
  if (!seen.size && lastError) throw lastError
  return [...seen.values()]
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, config.newsApi.maxArticles)
}

function refreshInBackground() {
  inFlight ??= fetchFromGNews()
    .then((articles) => { cache = { fetchedAt: Date.now(), articles } })
    .catch((error) => console.error('real-estate-news background refresh failed:', error.message))
    .finally(() => { inFlight = null })
}

// Returns { configured, articles } — always immediately, never blocking on GNews. `configured:
// false` (no NEWS_API_KEY set) is the expected state for anyone who hasn't signed up for a
// provider yet. Stale-while-revalidate: a stale/missing cache still returns instantly (stale data,
// or an empty list on a cold start) while a refresh kicks off in the background — 7 search terms,
// each spaced a second apart with its own retry, can legitimately take 10-20+ seconds, and no page
// load should ever block on that. The next request (even the same visitor reloading) sees whatever
// the background refresh produced, once it lands.
export function fetchRealEstateNews() {
  if (!config.newsApi.apiKey) return { configured: false, articles: [] }
  if (!isFresh()) refreshInBackground()
  return { configured: true, articles: cache?.articles ?? [] }
}
