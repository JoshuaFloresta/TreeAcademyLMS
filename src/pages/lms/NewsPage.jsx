import { useQuery } from '@tanstack/react-query'
import { BookOpen } from 'lucide-react'
import { fetchCalendar } from '../../lib/lms.js'
import Loading from '../../components/Loading.jsx'

function timeAgo(dateString) {
  const diffMs = Date.now() - new Date(dateString).getTime()
  const days = Math.floor(diffMs / 86_400_000)
  if (days < 1) return 'Today'
  return `${days} day${days === 1 ? '' : 's'} ago`
}

// Academy-wide news is modeled as calendar events with eventType "announcement" — the same
// content staff publish to the calendar, surfaced here as a readable feed.
export default function NewsPage() {
  const { data: stories = [], isLoading, error } = useQuery({ queryKey: ['calendar', 'announcement'], queryFn: () => fetchCalendar('announcement') })
  const sorted = [...stories].sort((first, second) => new Date(second.startsAt) - new Date(first.startsAt))

  return <>
    <div className="page-title-row"><div><p className="eyebrow">FROM THE ACADEMY</p><h1>News &amp; insights</h1><p>Updates, guidance, and timely learning notes from the Tree Academy team.</p></div></div>
    {isLoading && <Loading block label="Loading news…" />}
    {error && <div className="empty-state"><BookOpen size={26} /><strong>Could not load news</strong><p>{error.message}</p></div>}
    {!isLoading && !error && sorted.length === 0 && <div className="empty-state"><BookOpen size={26} /><strong>No news yet</strong><p>Academy announcements will appear here.</p></div>}
    <div className="notification-list">
      {sorted.map((story) => <article key={story._id} className="notification-item"><span className="notice-icon"><BookOpen size={18} /></span><div><strong>{story.title}</strong><p>{story.description}</p><small>{timeAgo(story.startsAt)}</small></div></article>)}
    </div>
  </>
}
