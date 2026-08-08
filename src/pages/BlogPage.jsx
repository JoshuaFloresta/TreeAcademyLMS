import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowUpRight, CalendarClock, Newspaper } from 'lucide-react'
import PublicHeader from '../components/PublicHeader.jsx'
import PublicFooter from '../components/PublicFooter.jsx'
import StatusPill from '../components/StatusPill.jsx'
import { fetchBlogPosts, fetchRealEstateNews } from '../lib/publicCatalog.js'

const categoryLabel = {
  program_updates: 'Program updates',
  exam_tips: 'Exam tips',
  real_estate_news: 'Real estate',
  company_news: 'Academy news',
}
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '')

export default function BlogPage() {
  const { data: posts = [], isLoading } = useQuery({ queryKey: ['public-blog'], queryFn: fetchBlogPosts, staleTime: 60_000 })
  const { data: news = { configured: false, articles: [] } } = useQuery({ queryKey: ['public-real-estate-news'], queryFn: fetchRealEstateNews, staleTime: 5 * 60_000 })

  return <div className="public-page">
    <PublicHeader />
    <main>
      <section className="blog-hero shell section">
        <div className="section-heading">
          <div><p className="eyebrow">FROM THE ACADEMY</p><h2>Insights, updates,<br /><em>and the market around you.</em></h2></div>
          <p className="section-copy">Program news, exam-prep guidance, and what's moving in Philippine real estate.</p>
        </div>
      </section>

      <section className="blog-layout shell section">
        <div className="blog-list">
          {isLoading && <p className="operations-note">Loading posts…</p>}
          {!isLoading && !posts.length && <div className="empty-state"><Newspaper size={26} /><strong>No posts yet</strong><p>Check back soon — the academy is just getting started here.</p></div>}
          <div className="blog-grid">
            {posts.map((post) => <Link className="blog-card" to={`/blog/${post.slug}`} key={post.id}>
              {post.coverImageUrl && <div className="blog-card-cover" style={{ backgroundImage: `url(${post.coverImageUrl})` }} />}
              <div className="blog-card-body">
                <StatusPill kind="gold">{categoryLabel[post.category] ?? post.category}</StatusPill>
                <h3>{post.title}</h3>
                {post.excerpt && <p>{post.excerpt}</p>}
                <small><CalendarClock size={13} /> {formatDate(post.publishedAt)}</small>
              </div>
            </Link>)}
          </div>
        </div>

        {news.configured && <aside className="blog-news-panel">
          <p className="eyebrow">REAL ESTATE NEWS</p>
          <h3>What's happening<br />in the market.</h3>
          {!news.articles.length && <p className="operations-note">No headlines available right now.</p>}
          <ul>
            {news.articles.map((article) => <li key={article.url}>
              <a href={article.url} target="_blank" rel="noreferrer">
                <span>{article.title}</span>
                <small>{article.sourceName} <ArrowUpRight size={11} /></small>
              </a>
            </li>)}
          </ul>
        </aside>}
      </section>
    </main>
    <PublicFooter />
  </div>
}
