import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpDown, Image as ImageIcon, Lock, LockOpen, MessageSquare, Pencil, Pin, PinOff, Plus, Send, Share2, ThumbsDown, ThumbsUp, Trash2, Users, X } from 'lucide-react'
import { avatarSrc } from '../../lib/api.js'
import { useConfirm } from '../../lib/confirmContext.js'
import { useToast } from '../../lib/toastContext.js'
import { createThread, deleteForumPost, deleteThread, fetchCourses, fetchThread, fetchThreads, moderateThread, reactToThread, replyToThread, updateForumPost, uploadForumImage } from '../../lib/lms.js'
import Loading from '../../components/Loading.jsx'

const when = (value) => new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const roleTag = (role) => (role === 'learner' ? null : <em className="forum-role-tag">{role}</em>)
const initialsOf = (name) => (name || '?').trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()

// Compact "32m ago" form for the list row — the thread view keeps the absolute timestamp, since
// that's where you'd want the precise date, but a scannable list reads better relative.
function timeAgo(value) {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function ThreadAvatar({ name, avatarUrl }) {
  return <span className="forum-avatar" style={avatarUrl ? { backgroundImage: `url(${avatarSrc(avatarUrl)})` } : undefined}>{!avatarUrl && initialsOf(name)}</span>
}

// Overlapping face-pile for "who's in this discussion" — the opening poster plus up to a few
// of the most recent repliers, newest-first order from the server.
function ParticipantStack({ participants }) {
  if (!participants?.length) return null
  return <span className="forum-avatar-stack">{participants.map((person, index) => <ThreadAvatar key={`${person.name}-${index}`} name={person.name} avatarUrl={person.avatarUrl} />)}</span>
}

// Upload-then-attach, same pattern as avatar/banner uploads: pick a file, it uploads immediately,
// and the resulting URL rides along with whichever form is holding this field on submit.
function ImageAttach({ imageUrl, uploading, onSelect, onRemove }) {
  const inputRef = useRef(null)
  return <div className="forum-attach">
    <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) onSelect(file); event.target.value = '' }} />
    {imageUrl
      ? <span className="forum-attach-preview"><img src={avatarSrc(imageUrl)} alt="" /><button type="button" onClick={onRemove} aria-label="Remove image"><X size={12} /></button></span>
      : <button type="button" className="forum-attach-button" onClick={() => inputRef.current?.click()} disabled={uploading}><ImageIcon size={14} /> {uploading ? 'Uploading…' : 'Add image'}</button>}
  </div>
}

function NewThreadForm({ courses, isStaff, onDone, onCancel }) {
  const [values, setValues] = useState({ courseId: '', title: '', body: '', isLocked: false, imageUrl: '' })
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const toast = useToast()
  const mutation = useMutation({ mutationFn: () => createThread({ courseId: values.courseId || courses[0]?._id, title: values.title.trim(), body: values.body.trim(), imageUrl: values.imageUrl || undefined, isLocked: isStaff ? values.isLocked : undefined }) })
  const attachImage = async (file) => {
    setUploading(true)
    try { const { imageUrl } = await uploadForumImage(file); setValues((prev) => ({ ...prev, imageUrl })) } catch (e) { toast.error(e.message) } finally { setUploading(false) }
  }
  const submit = async (event) => {
    event.preventDefault()
    if (values.title.trim().length < 2 || values.body.trim().length < 2) { setError('Add a title and an opening post.'); return }
    setError('')
    try { await mutation.mutateAsync(); toast.success('Discussion posted.'); onDone() } catch (e) { setError(e.message) }
  }
  return <form className="announce-form" onSubmit={submit}>
    <select value={values.courseId || courses[0]?._id || ''} onChange={(event) => setValues((prev) => ({ ...prev, courseId: event.target.value }))} aria-label="Course">{courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}</select>
    <input value={values.title} onChange={(event) => setValues((prev) => ({ ...prev, title: event.target.value }))} placeholder="Discussion title" aria-label="Title" />
    <textarea value={values.body} onChange={(event) => setValues((prev) => ({ ...prev, body: event.target.value }))} placeholder="Start the conversation…" rows={4} />
    <ImageAttach imageUrl={values.imageUrl} uploading={uploading} onSelect={attachImage} onRemove={() => setValues((prev) => ({ ...prev, imageUrl: '' }))} />
    {/* Only staff get this: letting any thread creator lock their own thread would hand a learner
        moderator-only reply gating on something they started. The server enforces this too. */}
    {isStaff && <label className="forum-audience-field">
      <span><Users size={13} /> Who can reply?</span>
      <select value={values.isLocked ? 'staff' : 'everyone'} onChange={(event) => setValues((prev) => ({ ...prev, isLocked: event.target.value === 'staff' }))}>
        <option value="everyone">Everyone enrolled</option>
        <option value="staff">Instructors &amp; admins only</option>
      </select>
    </label>}
    <div className="builder-lesson-actions"><button className="button button-primary button-compact" disabled={mutation.isPending}>Post discussion</button><button type="button" className="button button-ghost button-compact" onClick={onCancel}>Cancel</button></div>
    {error && <span className="builder-error">{error}</span>}
  </form>
}

// Split out from ThreadView so nothing here can ever read `thread.*` before the query resolves —
// mounting this only once `thread` is truthy avoids the null-closure crash the calendar detail
// view hit earlier (React Compiler's auto-memoization reads closure member expressions like
// `thread.isLocked` even for branches that don't run yet, if the component itself is always mounted).
function ThreadBody({ thread, threadId, isStaff, user, onBack }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [replyOpen, setReplyOpen] = useState(false)
  const [reply, setReply] = useState('')
  const [replyImageUrl, setReplyImageUrl] = useState('')
  const [replyUploading, setReplyUploading] = useState(false)
  const [replySort, setReplySort] = useState('oldest')
  const [editingPostId, setEditingPostId] = useState('')
  const [editDraft, setEditDraft] = useState('')
  const [editImageUrl, setEditImageUrl] = useState('')
  const [editUploading, setEditUploading] = useState(false)
  const updateMutation = useMutation({ mutationFn: ({ id, payload }) => updateForumPost(id, payload) })
  const reactMutation = useMutation({ mutationFn: (type) => reactToThread(threadId, type) })
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['forum-thread', threadId] }); queryClient.invalidateQueries({ queryKey: ['forum-threads'] }) }
  const act = async (fn, message) => { try { await fn(); if (message) toast.success(message); refresh() } catch (e) { toast.error(e.message) } }
  const react = async (type) => {
    try { await reactMutation.mutateAsync(type); refresh() } catch (e) { toast.error(e.message) }
  }

  const attachReplyImage = async (file) => {
    setReplyUploading(true)
    try { const { imageUrl } = await uploadForumImage(file); setReplyImageUrl(imageUrl) } catch (e) { toast.error(e.message) } finally { setReplyUploading(false) }
  }
  const sendReply = async (event) => {
    event.preventDefault()
    if (!reply.trim()) return
    try { await replyToThread(threadId, { body: reply.trim(), imageUrl: replyImageUrl || undefined }); setReply(''); setReplyImageUrl(''); setReplyOpen(false); refresh() } catch (e) { toast.error(e.message) }
  }
  const removeThread = async () => {
    if (!(await confirm({ title: 'Delete this discussion?', message: 'This discussion and all its replies will be permanently deleted.', confirmLabel: 'Delete discussion' }))) return
    try { await deleteThread(threadId); toast.success('Discussion deleted.'); queryClient.invalidateQueries({ queryKey: ['forum-threads'] }); onBack() } catch (e) { toast.error(e.message) }
  }
  const startEdit = (post) => { setEditingPostId(post.id); setEditDraft(post.body); setEditImageUrl(post.imageUrl ?? '') }
  const cancelEdit = () => { setEditingPostId(''); setEditDraft(''); setEditImageUrl('') }
  const attachEditImage = async (file) => {
    setEditUploading(true)
    try { const { imageUrl } = await uploadForumImage(file); setEditImageUrl(imageUrl) } catch (e) { toast.error(e.message) } finally { setEditUploading(false) }
  }
  const saveEdit = async (postId) => {
    if (!editDraft.trim()) return
    try { await updateMutation.mutateAsync({ id: postId, payload: { body: editDraft.trim(), imageUrl: editImageUrl || null } }); setEditingPostId(''); setEditDraft(''); setEditImageUrl(''); refresh() } catch (e) { toast.error(e.message) }
  }
  const removeReply = async (postId) => {
    if (!(await confirm({ title: 'Remove this reply?', message: 'This reply will be permanently removed.', confirmLabel: 'Remove reply' }))) return
    act(() => deleteForumPost(postId), 'Reply removed.')
  }
  const toggleLock = async () => {
    if (!thread.isLocked && !(await confirm({ title: 'Lock this discussion?', message: 'Learners will no longer be able to reply until it is unlocked.', confirmLabel: 'Lock', danger: false }))) return
    act(() => moderateThread(threadId, { isLocked: !thread.isLocked }), thread.isLocked ? 'Discussion unlocked.' : 'Discussion locked.')
  }
  const shareLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); toast.success('Link copied.') } catch { toast.error('Could not copy the link.') }
  }

  const canReply = !thread.isLocked || isStaff
  const sortedPosts = useMemo(() => (replySort === 'newest' ? [...thread.posts].reverse() : thread.posts), [thread.posts, replySort])

  return <>
    <button type="button" className="forum-back" onClick={onBack}><ArrowLeft size={15} /> All discussions</button>
    <article className="forum-thread">
      <div className="forum-thread-top">
        <div className="forum-thread-identity">
          <ThreadAvatar name={thread.authorName} avatarUrl={thread.authorAvatarUrl} />
          <div className="forum-thread-source-block">
            <span className="forum-thread-source">{thread.courseTitle} · {timeAgo(thread.createdAt)}</span>
            <span className="announce-meta">{thread.authorName} {roleTag(thread.authorRole)}</span>
          </div>
        </div>
        {isStaff && <span className="forum-mod-actions">
          <button type="button" onClick={() => act(() => moderateThread(threadId, { isPinned: !thread.isPinned }), thread.isPinned ? 'Discussion unpinned.' : 'Discussion pinned.')} aria-label={thread.isPinned ? 'Unpin' : 'Pin'}>{thread.isPinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
          <button type="button" onClick={toggleLock} aria-label={thread.isLocked ? 'Unlock' : 'Lock'}>{thread.isLocked ? <LockOpen size={14} /> : <Lock size={14} />}</button>
          <button type="button" className="builder-danger" onClick={removeThread} aria-label="Delete discussion"><Trash2 size={14} /></button>
        </span>}
      </div>
      <h2 className="forum-thread-title">{thread.title}</h2>
      {(thread.isPinned || thread.isLocked) && <div className="forum-flair-row">
        {thread.isPinned && <span className="forum-flair pinned"><Pin size={11} /> Pinned</span>}
        {thread.isLocked && <span className="forum-flair locked"><Lock size={11} /> Staff replies only</span>}
      </div>}
      <p className="forum-thread-body">{thread.body}</p>
      {thread.imageUrl && <img className="forum-post-image" src={avatarSrc(thread.imageUrl)} alt="" />}
      <div className="forum-thread-actions">
        <span className="forum-stat"><MessageSquare size={14} /> {thread.posts.length} {thread.posts.length === 1 ? 'reply' : 'replies'}</span>
        <button type="button" className={`forum-stat${thread.myReaction === 'like' ? ' active' : ''}`} onClick={() => react('like')} aria-pressed={thread.myReaction === 'like'}><ThumbsUp size={14} /> {thread.likeCount ?? 0}</button>
        <button type="button" className={`forum-stat${thread.myReaction === 'dislike' ? ' active' : ''}`} onClick={() => react('dislike')} aria-pressed={thread.myReaction === 'dislike'}><ThumbsDown size={14} /> {thread.dislikeCount ?? 0}</button>
        <button type="button" className="forum-stat" onClick={shareLink}><Share2 size={14} /> Share</button>
      </div>
    </article>

    <div className="forum-posts-toolbar">
      <span>{thread.posts.length} {thread.posts.length === 1 ? 'Reply' : 'Replies'}</span>
      <select value={replySort} onChange={(event) => setReplySort(event.target.value)} aria-label="Sort replies">
        <option value="oldest">Oldest first</option>
        <option value="newest">Newest first</option>
      </select>
    </div>

    <div className="forum-posts">
      {sortedPosts.map((post) => {
        const isOwn = post.authorId === user?.id
        const isEditing = editingPostId === post.id
        return <div className="forum-post" key={post.id}>
          <div className="forum-post-head">
            <ThreadAvatar name={post.authorName} avatarUrl={post.authorAvatarUrl} /><strong>{post.authorName}</strong> {roleTag(post.authorRole)}
            <span>{when(post.createdAt)}{post.editedAt && ' · edited'}</span>
            {!isEditing && (isOwn || isStaff) && <span className="forum-post-actions">
              {isOwn && <button type="button" onClick={() => startEdit(post)} aria-label="Edit reply"><Pencil size={12} /></button>}
              <button type="button" className="builder-danger" onClick={() => removeReply(post.id)} aria-label="Remove reply"><Trash2 size={12} /></button>
            </span>}
          </div>
          {isEditing
            ? <div className="forum-post-edit">
              <textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} rows={3} />
              <ImageAttach imageUrl={editImageUrl} uploading={editUploading} onSelect={attachEditImage} onRemove={() => setEditImageUrl('')} />
              <div className="builder-lesson-actions">
                <button type="button" className="button button-primary button-compact" onClick={() => saveEdit(post.id)} disabled={updateMutation.isPending || !editDraft.trim()}>Save</button>
                <button type="button" className="button button-ghost button-compact" onClick={cancelEdit}>Cancel</button>
              </div>
            </div>
            : <>
              <p>{post.body}</p>
              {post.imageUrl && <img className="forum-post-image" src={avatarSrc(post.imageUrl)} alt="" />}
            </>}
        </div>
      })}
      {!thread.posts.length && <p className="operations-note">No replies yet — be the first.</p>}
    </div>

    {canReply
      ? (replyOpen
        ? <form className="forum-reply" onSubmit={sendReply}>
          <textarea autoFocus value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write a reply…" rows={3} />
          <div className="forum-reply-foot">
            <ImageAttach imageUrl={replyImageUrl} uploading={replyUploading} onSelect={attachReplyImage} onRemove={() => setReplyImageUrl('')} />
            <div className="builder-lesson-actions">
              <button type="button" className="button button-ghost button-compact" onClick={() => { setReplyOpen(false); setReply(''); setReplyImageUrl('') }}>Cancel</button>
              <button className="button button-primary button-compact" disabled={!reply.trim()}><Send size={14} /> Reply</button>
            </div>
          </div>
        </form>
        : <button type="button" className="forum-reply-trigger" onClick={() => setReplyOpen(true)}>Join the conversation</button>)
      : <p className="operations-note"><Lock size={15} /> This discussion is locked.</p>}
  </>
}

function ThreadView({ threadId, isStaff, user, onBack }) {
  const { data: thread, isLoading } = useQuery({ queryKey: ['forum-thread', threadId], queryFn: () => fetchThread(threadId) })
  if (isLoading || !thread) return <Loading label="Loading discussion…" />
  return <ThreadBody thread={thread} threadId={threadId} isStaff={isStaff} user={user} onBack={onBack} />
}

const sortOptions = [
  { value: 'recent', label: 'Recent' },
  { value: 'active', label: 'Most replies' },
]

export default function ForumsPage({ role, user, initialThreadId }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isStaff = role !== 'learner'
  const [courseFilter, setCourseFilter] = useState('')
  const [sort, setSort] = useState('recent')
  const [composing, setComposing] = useState(false)
  const openThreadId = initialThreadId ?? ''
  const { data: threads = [], isLoading } = useQuery({ queryKey: ['forum-threads', courseFilter], queryFn: () => fetchThreads(courseFilter || undefined) })
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['forum-threads'] })

  // Pinned threads always lead regardless of sort — that's what pinning is for. Within each group,
  // "Recent" keeps the server's lastPostAt order; "Most replies" is a pure client-side re-sort
  // since the full list (capped at 100) is already in hand.
  const sortedThreads = useMemo(() => {
    const pinned = threads.filter((thread) => thread.isPinned)
    const rest = threads.filter((thread) => !thread.isPinned)
    if (sort === 'active') rest.sort((first, second) => second.replyCount - first.replyCount)
    return [...pinned, ...rest]
  }, [threads, sort])

  if (openThreadId) return <ThreadView threadId={openThreadId} isStaff={isStaff} user={user} onBack={() => navigate('/forums')} />

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">{isStaff ? 'TEACHING WORKSPACE' : 'YOUR CLASSES'}</p><h1>Discussions {threads.length > 0 && <span className="forum-count">{threads.length}</span>}</h1><p>{isStaff ? 'Participate in and moderate course discussions.' : 'Ask questions and learn together with your class.'}</p></div>
      {courses.length > 0 && !composing && <button type="button" className="button button-primary" onClick={() => setComposing(true)}><Plus size={16} /> Start a discussion</button>}
    </div>
    {composing && <NewThreadForm courses={courses} isStaff={isStaff} onDone={() => { refresh(); setComposing(false) }} onCancel={() => setComposing(false)} />}
    <div className="forum-toolbar">
      <select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)} aria-label="Filter by course"><option value="">All courses</option>{courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}</select>
      <button type="button" className="forum-sort-toggle" onClick={() => setSort((current) => (current === 'recent' ? 'active' : 'recent'))} title="Toggle sort order">
        <ArrowUpDown size={13} /> {sortOptions.find((option) => option.value === sort)?.label}
      </button>
    </div>
    <div className="forum-list">
      {isLoading ? <Loading label="Loading discussions…" />
        : !threads.length ? <div className="empty-state"><MessageSquare size={26} /><strong>No discussions yet</strong><p>Start the first one — questions and conversation for this course will collect here.</p></div>
        : sortedThreads.map((thread) => <button type="button" className="forum-row" key={thread.id} onClick={() => navigate(`/forums/${thread.id}`)}>
          {thread.imageUrl && <img className="forum-row-thumb" src={avatarSrc(thread.imageUrl)} alt="" />}
          <span className="forum-row-main">
            <small>{thread.courseTitle.toUpperCase()}</small>
            <strong>{thread.isPinned && <Pin size={12} />} {thread.title} {thread.isLocked && <Lock size={12} title="Instructors & admins only" />}</strong>
            <span className="forum-row-stats">
              <ParticipantStack participants={thread.participants} />
              <span>{thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'} · {thread.viewCount ?? 0} {thread.viewCount === 1 ? 'view' : 'views'} · Last reply {timeAgo(thread.lastPostAt)}</span>
            </span>
          </span>
        </button>)}
    </div>
  </>
}
