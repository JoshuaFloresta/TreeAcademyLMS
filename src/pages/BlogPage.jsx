import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowUpRight, CalendarClock } from 'lucide-react'
import PublicHeader from '../components/PublicHeader.jsx'
import PublicFooter from '../components/PublicFooter.jsx'
import StatusPill from '../components/StatusPill.jsx'
import { fetchBlogPosts, fetchRealEstateNews } from '../lib/publicCatalog.js'
import { publicImageSrc } from '../lib/api.js'

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

      {/* Hidden entirely (no heading, no empty state) once loading finishes with nothing to show —
          an admin who hasn't published anything yet shouldn't advertise an empty blog. */}
      {(isLoading || posts.length > 0) && <section className="academy-blog-section shell section">
        <div className="section-heading">
          <div><p className="eyebrow">ACADEMY BLOG</p><h2>Straight from<br /><em>the team.</em></h2></div>
        </div>
        {isLoading
          ? <p className="operations-note">Loading posts…</p>
          : <div className="blog-grid">
            {posts.map((post) => <Link className="blog-card" to={`/blog/${post.slug}`} key={post.id}>
              {post.coverImageUrl && <div className="blog-card-cover" style={{ backgroundImage: `url(${publicImageSrc(post.coverImageUrl)})` }} />}
              <div className="blog-card-body">
                <StatusPill kind="gold">{categoryLabel[post.category] ?? post.category}</StatusPill>
                <h3>{post.title}</h3>
                {post.excerpt && <p>{post.excerpt}</p>}
                <small><CalendarClock size={13} /> {formatDate(post.publishedAt)}</small>
              </div>
            </Link>)}
          </div>}
      </section>}

      {news.configured && <section className="news-section shell section">
        <div className="section-heading">
          <div><p className="eyebrow">REAL ESTATE NEWS</p><h2>What's happening<br /><em>in the market.</em></h2></div>
        </div>
        {!news.articles.length
          ? <p className="operations-note">No headlines available right now.</p>
          : <div className="blog-grid">
            {news.articles.map((article) => <a className="blog-card news-card" href={article.url} target="_blank" rel="noreferrer" key={article.url}>
              {article.imageUrl && <div className="blog-card-cover" style={{ backgroundImage: `url(${article.imageUrl})` }} />}
              <div className="blog-card-body">
                <h3>{article.title}</h3>
                {article.description && <p>{article.description}</p>}
                <small>{article.sourceName} <ArrowUpRight size={12} /></small>
              </div>
            </a>)}
          </div>}
      </section>}
    </main>
    <PublicFooter />
  </div>
}
