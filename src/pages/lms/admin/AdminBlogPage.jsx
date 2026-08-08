import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, FileText, Newspaper, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import StatusPill from '../../../components/StatusPill.jsx'
import { useConfirm } from '../../../lib/confirmContext.js'
import { useToast } from '../../../lib/toastContext.js'
import { createBlogPost, deleteBlogPost, fetchAdminBlogPosts, updateBlogPost, uploadBlogCover } from '../../../lib/admin.js'
import Loading from '../../../components/Loading.jsx'

const categoryOptions = [
  ['program_updates', 'Program updates'],
  ['exam_tips', 'Exam tips'],
  ['real_estate_news', 'Real estate'],
  ['company_news', 'Academy news'],
]
const slugify = (value) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200)
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : '—')

function BlogForm({ post, onDone, onCancel }) {
  const [values, setValues] = useState({
    title: post?.title ?? '', slug: post?.slug ?? '', excerpt: post?.excerpt ?? '', body: post?.body ?? '',
    category: post?.category ?? 'program_updates', coverImageUrl: post?.coverImageUrl ?? '',
  })
  const [touchedSlug, setTouchedSlug] = useState(Boolean(post))
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)
  const toast = useToast()

  const setTitle = (title) => setValues((v) => ({ ...v, title, slug: touchedSlug ? v.slug : slugify(title) }))
  const payload = (status) => ({
    title: values.title.trim(), slug: slugify(values.slug), excerpt: values.excerpt.trim() || undefined,
    body: values.body.trim(), category: values.category, coverImageUrl: values.coverImageUrl || null, status,
  })
  const mutation = useMutation({ mutationFn: (status) => (post ? updateBlogPost(post.id, payload(status)) : createBlogPost(payload(status))) })
  const submit = async (status) => {
    if (values.title.trim().length < 2) { setError('Add a title.'); return }
    if (values.body.trim().length < 2) { setError('Add some content.'); return }
    setError('')
    try { await mutation.mutateAsync(status); toast.success(post ? 'Post updated.' : status === 'published' ? 'Post published.' : 'Draft saved.'); onDone() }
    catch (e) { setError(e.message) }
  }
  const chooseFile = () => fileInputRef.current?.click()
  const onFileChosen = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    try { const { coverImageUrl } = await uploadBlogCover(file); setValues((v) => ({ ...v, coverImageUrl })) }
    catch (e) { toast.error(e.message) }
    finally { setUploading(false) }
  }

  return <form className="admin-blog-form" onSubmit={(event) => event.preventDefault()}>
    <input value={values.title} onChange={(e) => setTitle(e.target.value)} placeholder="Post title" aria-label="Title" />
    <div className="admin-course-slug-edit"><span>/blog/</span><input value={values.slug} onChange={(e) => { setTouchedSlug(true); setValues((v) => ({ ...v, slug: slugify(e.target.value) })) }} placeholder={slugify(values.title) || 'post-slug'} aria-label="Slug" /></div>
    <textarea value={values.excerpt} onChange={(e) => setValues((v) => ({ ...v, excerpt: e.target.value }))} placeholder="Short excerpt for the listing page (optional)" rows={2} maxLength={300} />
    <textarea value={values.body} onChange={(e) => setValues((v) => ({ ...v, body: e.target.value }))} placeholder="Write the post…" rows={10} />
    <div className="builder-lesson-row">
      <label className="builder-field"><span>Category</span>
        <select value={values.category} onChange={(e) => setValues((v) => ({ ...v, category: e.target.value }))}>
          {categoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="builder-field"><span>Cover image (optional)</span>
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFileChosen} />
        {values.coverImageUrl
          ? <div className="admin-agreement-row"><FileText size={13} /> Image attached
            <button type="button" className="admin-count-toggle" title="Replace" onClick={chooseFile}><Upload size={12} /></button>
            <button type="button" className="admin-count-toggle" title="Remove" onClick={() => setValues((v) => ({ ...v, coverImageUrl: '' }))}><X size={12} /></button>
          </div>
          : <button type="button" className="button button-ghost button-compact" onClick={chooseFile} disabled={uploading}><Upload size={13} /> {uploading ? 'Uploading…' : 'Upload image'}</button>}
      </label>
    </div>
    <div className="builder-lesson-actions">
      <button type="button" className="button button-primary button-compact" disabled={mutation.isPending} onClick={() => submit('published')}>{post?.status === 'published' ? 'Save changes' : 'Publish'}</button>
      <button type="button" className="button button-ghost button-compact" disabled={mutation.isPending} onClick={() => submit('draft')}>Save as draft</button>
      <button type="button" className="button button-ghost button-compact" onClick={onCancel}>Cancel</button>
    </div>
    {error && <span className="builder-error">{error}</span>}
  </form>
}

export default function AdminBlogPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState('')
  const { data: posts = [], isLoading } = useQuery({ queryKey: ['admin-blog'], queryFn: fetchAdminBlogPosts })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-blog'] })
  const publishMutation = useMutation({ mutationFn: ({ id, status }) => updateBlogPost(id, { status }) })
  const deleteMutation = useMutation({ mutationFn: (id) => deleteBlogPost(id) })
  const act = async (fn, message) => { try { await fn(); if (message) toast.success(message); invalidate() } catch (e) { toast.error(e.message) } }
  const removePost = async (post) => {
    if (!(await confirm({ title: 'Delete this post?', message: `“${post.title}” will be permanently deleted.`, confirmLabel: 'Delete post' }))) return
    act(() => deleteMutation.mutateAsync(post.id), 'Post deleted.')
  }

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">PLATFORM ADMIN</p><h1>Blog</h1><p>Program updates, exam tips, and real-estate commentary — shown publicly at /blog.</p></div>
      {!adding && <button className="button button-primary" onClick={() => { setAdding(true); setEditingId('') }}><Plus size={16} /> New post</button>}
    </div>
    {adding && <BlogForm onCancel={() => setAdding(false)} onDone={() => { setAdding(false); invalidate() }} />}
    <div className="admin-webinar-list">
      {isLoading ? <Loading label="Loading posts…" />
        : !posts.length ? <p className="operations-note"><Newspaper size={17} /> No posts yet.</p>
        : posts.map((post) => <article className="admin-webinar-card" key={post.id}>
          {editingId === post.id
            ? <BlogForm post={post} onCancel={() => setEditingId('')} onDone={() => { setEditingId(''); invalidate() }} />
            : <>
              <div className="admin-webinar-head">
                <div><strong>{post.title}</strong><small>/blog/{post.slug} · {post.authorName} · {post.status === 'published' ? formatDate(post.publishedAt) : 'Not published'}</small></div>
                <div className="admin-status-cell">
                  <StatusPill kind={post.status === 'published' ? 'green' : 'gold'}>{post.status === 'published' ? 'Published' : 'Draft'}</StatusPill>
                  <StatusPill kind="gold">{categoryOptions.find(([value]) => value === post.category)?.[1] ?? post.category}</StatusPill>
                </div>
              </div>
              {post.excerpt && <p className="admin-webinar-desc">{post.excerpt}</p>}
              <div className="admin-row-actions">
                <button className="button button-ghost button-compact" onClick={() => act(() => publishMutation.mutateAsync({ id: post.id, status: post.status === 'published' ? 'draft' : 'published' }), post.status === 'published' ? 'Post unpublished.' : 'Post published.')}>{post.status === 'published' ? <><EyeOff size={14} /> Unpublish</> : <><Eye size={14} /> Publish</>}</button>
                <button className="button button-ghost button-compact" onClick={() => { setEditingId(post.id); setAdding(false) }}><Pencil size={13} /> Edit</button>
                <button className="button button-ghost button-compact button-danger" onClick={() => removePost(post)}><Trash2 size={14} /> Delete</button>
              </div>
            </>}
        </article>)}
    </div>
  </>
}
