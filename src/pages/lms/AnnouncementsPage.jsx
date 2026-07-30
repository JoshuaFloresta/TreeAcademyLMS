import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Megaphone, Pin, Plus, Trash2 } from 'lucide-react'
import { useConfirm } from '../../lib/confirmContext.js'
import { useToast } from '../../lib/toastContext.js'
import { createAnnouncement, deleteAnnouncement, fetchAnnouncements, fetchCourses } from '../../lib/lms.js'
import Loading from '../../components/Loading.jsx'

const when = (value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function ComposeForm({ courses, onDone, onCancel }) {
  const [values, setValues] = useState({ courseId: '', title: '', body: '', pinned: false })
  const [error, setError] = useState('')
  const toast = useToast()
  const mutation = useMutation({ mutationFn: () => createAnnouncement(values.courseId || courses[0]?._id, { title: values.title.trim(), body: values.body.trim(), pinned: values.pinned }) })
  const submit = async (event) => {
    event.preventDefault()
    if (values.title.trim().length < 2 || values.body.trim().length < 2) { setError('Add a title and a message.'); return }
    setError('')
    try { await mutation.mutateAsync(); toast.success('Announcement posted.'); onDone() } catch (e) { setError(e.message) }
  }
  return <form className="announce-form" onSubmit={submit}>
    <select value={values.courseId || courses[0]?._id || ''} onChange={(event) => setValues((prev) => ({ ...prev, courseId: event.target.value }))} aria-label="Course">{courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}</select>
    <input value={values.title} onChange={(event) => setValues((prev) => ({ ...prev, title: event.target.value }))} placeholder="Announcement title" aria-label="Title" />
    <textarea value={values.body} onChange={(event) => setValues((prev) => ({ ...prev, body: event.target.value }))} placeholder="Write your message to the class…" rows={4} />
    <div className="announce-form-foot">
      <label className="builder-publish-check"><input type="checkbox" checked={values.pinned} onChange={(event) => setValues((prev) => ({ ...prev, pinned: event.target.checked }))} /> Pin to top</label>
      <div className="builder-lesson-actions"><button className="button button-primary button-compact" disabled={mutation.isPending}>Post announcement</button><button type="button" className="button button-ghost button-compact" onClick={onCancel}>Cancel</button></div>
    </div>
    {error && <span className="builder-error">{error}</span>}
  </form>
}

export default function AnnouncementsPage({ role, user }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const isStaff = role !== 'learner'
  const [composing, setComposing] = useState(false)
  const { data: announcements = [], isLoading } = useQuery({ queryKey: ['announcements'], queryFn: fetchAnnouncements })
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses, enabled: isStaff })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['announcements'] })

  const remove = async (announcement) => {
    if (!(await confirm({ title: 'Delete this announcement?', message: `“${announcement.title}” will be removed for everyone.`, confirmLabel: 'Delete announcement' }))) return
    try { await deleteAnnouncement(announcement.id); toast.success('Announcement deleted.'); refresh() } catch (e) { toast.error(e.message) }
  }
  // Admins moderate every announcement; instructors may only remove their own — mirrors the server check.
  const canDelete = (announcement) => role === 'admin' || announcement.authorId === user?.id

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">{isStaff ? 'TEACHING WORKSPACE' : 'YOUR CLASSES'}</p><h1>Announcements</h1><p>{isStaff ? 'Post course-wide updates — enrolled learners are notified automatically.' : 'Updates from your instructors, newest first.'}</p></div>
      {isStaff && courses.length > 0 && !composing && <button type="button" className="button button-primary" onClick={() => setComposing(true)}><Plus size={16} /> New announcement</button>}
    </div>
    {composing && <ComposeForm courses={courses} onDone={() => { refresh(); setComposing(false) }} onCancel={() => setComposing(false)} />}
    <div className="announce-list">
      {isLoading ? <Loading label="Loading announcements…" />
        : !announcements.length ? <p className="operations-note"><Megaphone size={17} /> No announcements yet.</p>
        : announcements.map((announcement) => <article className={`announce-card ${announcement.pinned ? 'pinned' : ''}`} key={announcement.id}>
          <div className="announce-head">
            <div><small>{announcement.courseTitle.toUpperCase()}</small><h3>{announcement.pinned && <Pin size={13} />} {announcement.title}</h3></div>
            <span className="announce-meta">{announcement.authorName} · {when(announcement.createdAt)}{isStaff && canDelete(announcement) && <button type="button" className="builder-danger" onClick={() => remove(announcement)} aria-label="Delete announcement"><Trash2 size={14} /></button>}</span>
          </div>
          <p>{announcement.body}</p>
        </article>)}
    </div>
  </>
}
