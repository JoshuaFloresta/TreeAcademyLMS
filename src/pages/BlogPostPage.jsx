import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarClock, FileQuestion } from 'lucide-react'
import PublicHeader from '../components/PublicHeader.jsx'
import PublicFooter from '../components/PublicFooter.jsx'
import StatusPill from '../components/StatusPill.jsx'
import Loading from '../components/Loading.jsx'
import { fetchBlogPost } from '../lib/publicCatalog.js'

const categoryLabel = {
  program_updates: 'Program updates',
  exam_tips: 'Exam tips',
  real_estate_news: 'Real estate',
  company_news: 'Academy news',
}
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '')

export default function BlogPostPage() {
  const { slug } = useParams()
  const { data: post, isLoading, error } = useQuery({ queryKey: ['public-blog-post', slug], queryFn: () => fetchBlogPost(slug), retry: false })

  return <div className="public-page">
    <PublicHeader />
    <main>
      <section className="blog-post shell section">
        <Link to="/blog" className="blog-back"><ArrowLeft size={15} /> Back to blog</Link>
        {isLoading && <Loading block label="Loading post…" />}
        {error && <div className="empty-state"><FileQuestion size={26} /><strong>Post not found</strong><p>It may have been unpublished or the link is out of date.</p></div>}
        {post && <article>
          {post.coverImageUrl && <div className="blog-post-cover" style={{ backgroundImage: `url(${post.coverImageUrl})` }} />}
          <StatusPill kind="gold">{categoryLabel[post.category] ?? post.category}</StatusPill>
          <h1>{post.title}</h1>
          <p className="blog-post-meta"><CalendarClock size={14} /> {formatDate(post.publishedAt)} · {post.authorName}</p>
          <div className="blog-post-body">{post.body}</div>
        </article>}
      </section>
    </main>
    <PublicFooter />
  </div>
}
