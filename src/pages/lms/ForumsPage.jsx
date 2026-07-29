import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Lock, LockOpen, MessageSquare, Pin, PinOff, Plus, Send, Trash2 } from 'lucide-react'
import { useConfirm } from '../../lib/confirmContext.js'
import { useToast } from '../../lib/toastContext.js'
import { createThread, deleteForumPost, deleteThread, fetchCourses, fetchThread, fetchThreads, moderateThread, replyToThread } from '../../lib/lms.js'

const when = (value) => new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const roleTag = (role) => (role === 'learner' ? null : <em className="forum-role-tag">{role}</em>)

function NewThreadForm({ courses, onDone }) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState({ courseId: '', title: '', body: '' })
  const [error, setError] = useState('')
  const toast = useToast()
  const mutation = useMutation({ mutationFn: () => createThread({ courseId: values.courseId || courses[0]?._id, title: values.title.trim(), body: values.body.trim() }) })
  const submit = async (event) => {
    event.preventDefault()
    if (values.title.trim().length < 2 || values.body.trim().length < 2) { setError('Add a title and an opening post.'); return }
    setError('')
    try { await mutation.mutateAsync(); toast.success('Discussion posted.'); setValues({ courseId: '', title: '', body: '' }); setOpen(false); onDone() } catch (e) { setError(e.message) }
  }
  if (!open) return <button type="button" className="button button-primary" onClick={() => setOpen(true)}><Plus size={16} /> Start a discussion</button>
  return <form className="announce-form" onSubmit={submit}>
    <select value={values.courseId || courses[0]?._id || ''} onChange={(event) => setValues((prev) => ({ ...prev, courseId: event.target.value }))} aria-label="Course">{courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}</select>
    <input value={values.title} onChange={(event) => setValues((prev) => ({ ...prev, title: event.target.value }))} placeholder="Discussion title" aria-label="Title" />
    <textarea value={values.body} onChange={(event) => setValues((prev) => ({ ...prev, body: event.target.value }))} placeholder="Start the conversation…" rows={4} />
    <div className="builder-lesson-actions"><button className="button button-primary button-compact" disabled={mutation.isPending}>Post discussion</button><button type="button" className="button button-ghost button-compact" onClick={() => setOpen(false)}>Cancel</button></div>
    {error && <span className="builder-error">{error}</span>}
  </form>
}

function ThreadView({ threadId, isStaff, user, onBack }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [reply, setReply] = useState('')
  const { data: thread, isLoading } = useQuery({ queryKey: ['forum-thread', threadId], queryFn: () => fetchThread(threadId) })
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['forum-thread', threadId] }); queryClient.invalidateQueries({ queryKey: ['forum-threads'] }) }
  const act = async (fn, message) => { try { await fn(); if (message) toast.success(message); refresh() } catch (e) { toast.error(e.message) } }

  const sendReply = async (event) => {
    event.preventDefault()
    if (!reply.trim()) return
    try { await replyToThread(threadId, reply.trim()); setReply(''); refresh() } catch (e) { toast.error(e.message) }
  }
  const removeThread = async () => {
    if (!(await confirm({ title: 'Delete this discussion?', message: 'This discussion and all its replies will be permanently deleted.', confirmLabel: 'Delete discussion' }))) return
    try { await deleteThread(threadId); toast.success('Discussion deleted.'); queryClient.invalidateQueries({ queryKey: ['forum-threads'] }); onBack() } catch (e) { toast.error(e.message) }
  }
  const removePost = () => confirm({ title: 'Remove this reply?', message: 'This reply will be permanently removed.', confirmLabel: 'Remove reply' })
  const toggleLock = async () => {
    if (!thread.isLocked && !(await confirm({ title: 'Lock this discussion?', message: 'Learners will no longer be able to reply until it is unlocked.', confirmLabel: 'Lock', danger: false }))) return
    act(() => moderateThread(threadId, { isLocked: !thread.isLocked }), thread.isLocked ? 'Discussion unlocked.' : 'Discussion locked.')
  }

  if (isLoading || !thread) return <p className="operations-note">Loading discussion…</p>
  const canReply = !thread.isLocked || isStaff

  return <>
    <button type="button" className="forum-back" onClick={onBack}><ArrowLeft size={15} /> All discussions</button>
    <article className="forum-thread">
      <div className="forum-thread-head">
        <div><small>{thread.courseTitle.toUpperCase()}</small><h2>{thread.isPinned && <Pin size={15} />} {thread.title} {thread.isLocked && <Lock size={14} />}</h2><span className="announce-meta">{thread.authorName} {roleTag(thread.authorRole)} · {when(thread.createdAt)}</span></div>
        {isStaff && <span className="forum-mod-actions">
          <button type="button" onClick={() => act(() => moderateThread(threadId, { isPinned: !thread.isPinned }), thread.isPinned ? 'Discussion unpinned.' : 'Discussion pinned.')} aria-label={thread.isPinned ? 'Unpin' : 'Pin'}>{thread.isPinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
          <button type="button" onClick={toggleLock} aria-label={thread.isLocked ? 'Unlock' : 'Lock'}>{thread.isLocked ? <LockOpen size={14} /> : <Lock size={14} />}</button>
          <button type="button" className="builder-danger" onClick={removeThread} aria-label="Delete discussion"><Trash2 size={14} /></button>
        </span>}
      </div>
      <p className="forum-thread-body">{thread.body}</p>
    </article>
    <div className="forum-posts">
      {thread.posts.map((post) => <div className="forum-post" key={post.id}>
        <div className="forum-post-head"><strong>{post.authorName}</strong> {roleTag(post.authorRole)} <span>{when(post.createdAt)}</span>{isStaff && post.authorId !== user?.id && <button type="button" className="builder-danger" onClick={async () => { if (await removePost()) act(() => deleteForumPost(post.id), 'Reply removed.') }} aria-label="Remove reply"><Trash2 size={12} /></button>}</div>
        <p>{post.body}</p>
      </div>)}
      {!thread.posts.length && <p className="operations-note">No replies yet — be the first.</p>}
    </div>
    {canReply
      ? <form className="forum-reply" onSubmit={sendReply}><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write a reply…" rows={3} /><button className="button button-primary button-compact" disabled={!reply.trim()}><Send size={14} /> Reply</button></form>
      : <p className="operations-note"><Lock size={15} /> This discussion is locked.</p>}
  </>
}

export default function ForumsPage({ role, user }) {
  const queryClient = useQueryClient()
  const isStaff = role !== 'learner'
  const [courseFilter, setCourseFilter] = useState('')
  const [openThreadId, setOpenThreadId] = useState('')
  const { data: threads = [], isLoading } = useQuery({ queryKey: ['forum-threads', courseFilter], queryFn: () => fetchThreads(courseFilter || undefined) })
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['forum-threads'] })

  if (openThreadId) return <ThreadView threadId={openThreadId} isStaff={isStaff} user={user} onBack={() => setOpenThreadId('')} />

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">{isStaff ? 'TEACHING WORKSPACE' : 'YOUR CLASSES'}</p><h1>Discussions</h1><p>{isStaff ? 'Participate in and moderate course discussions.' : 'Ask questions and learn together with your class.'}</p></div>
      {courses.length > 0 && <NewThreadForm courses={courses} onDone={refresh} />}
    </div>
    <div className="forum-filter"><select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)} aria-label="Filter by course"><option value="">All courses</option>{courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}</select></div>
    <div className="forum-list">
      {isLoading ? <p className="operations-note">Loading discussions…</p>
        : !threads.length ? <p className="operations-note"><MessageSquare size={17} /> No discussions yet — start the first one.</p>
        : threads.map((thread) => <button type="button" className="forum-row" key={thread.id} onClick={() => setOpenThreadId(thread.id)}>
          <span className="forum-row-main"><small>{thread.courseTitle.toUpperCase()}</small><strong>{thread.isPinned && <Pin size={12} />} {thread.title} {thread.isLocked && <Lock size={12} />}</strong><span className="announce-meta">{thread.authorName} {roleTag(thread.authorRole)}</span></span>
          <span className="forum-row-meta"><b><MessageSquare size={13} /> {thread.replyCount}</b><small>{when(thread.lastPostAt)}</small></span>
        </button>)}
    </div>
  </>
}
