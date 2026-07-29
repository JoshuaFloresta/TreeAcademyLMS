import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Eye, EyeOff, Plus, Trash2, Users } from 'lucide-react'
import StatusPill from '../../../components/StatusPill.jsx'
import { useConfirm } from '../../../lib/confirmContext.js'
import { useToast } from '../../../lib/toastContext.js'
import { createWebinar, deleteWebinar, fetchAdminWebinars, fetchWebinarRegistrations, updateWebinar } from '../../../lib/admin.js'

const toLocalInput = (value) => { if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
const formatDate = (value) => (value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

function WebinarForm({ webinar, onDone, onCancel }) {
  const [values, setValues] = useState({
    title: webinar?.title ?? '', description: webinar?.description ?? '',
    startsAt: toLocalInput(webinar?.startsAt) || toLocalInput(new Date()),
    registrationDeadline: toLocalInput(webinar?.registrationDeadline),
    capacity: webinar?.capacity ?? '',
  })
  const [error, setError] = useState('')
  const toast = useToast()
  const payload = () => ({
    title: values.title.trim(), description: values.description.trim() || undefined,
    startsAt: values.startsAt, registrationDeadline: values.registrationDeadline || null,
    capacity: values.capacity === '' ? null : Number(values.capacity),
  })
  const mutation = useMutation({ mutationFn: () => (webinar ? updateWebinar(webinar.id, payload()) : createWebinar(payload())) })
  const submit = async (event) => {
    event.preventDefault()
    if (values.title.trim().length < 2) { setError('Add a title.'); return }
    setError('')
    try { await mutation.mutateAsync(); toast.success(webinar ? 'Session updated.' : 'Session created.'); onDone() } catch (e) { setError(e.message) }
  }
  return <form className="admin-webinar-form" onSubmit={submit}>
    <input value={values.title} onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))} placeholder="Webinar or special course title" aria-label="Title" />
    <textarea value={values.description} onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))} placeholder="Description (optional)" rows={2} />
    <div className="builder-lesson-row">
      <label className="builder-field"><span>Session date</span><input type="datetime-local" value={values.startsAt} onChange={(e) => setValues((v) => ({ ...v, startsAt: e.target.value }))} /></label>
      <label className="builder-field"><span>Registration closes</span><input type="datetime-local" value={values.registrationDeadline} onChange={(e) => setValues((v) => ({ ...v, registrationDeadline: e.target.value }))} placeholder="Defaults to session date" /></label>
      <label className="builder-field"><span>Capacity</span><input type="number" min={1} value={values.capacity} onChange={(e) => setValues((v) => ({ ...v, capacity: e.target.value }))} placeholder="Unlimited" /></label>
    </div>
    <div className="builder-lesson-actions"><button className="button button-primary button-compact" disabled={mutation.isPending}>{webinar ? 'Save changes' : 'Create'}</button><button type="button" className="button button-ghost button-compact" onClick={onCancel}>Cancel</button></div>
    {error && <span className="builder-error">{error}</span>}
  </form>
}

function RegistrationsPanel({ webinarId }) {
  const { data: registrations = [], isLoading } = useQuery({ queryKey: ['webinar-registrations', webinarId], queryFn: () => fetchWebinarRegistrations(webinarId) })
  if (isLoading) return <p className="operations-note">Loading registrations…</p>
  if (!registrations.length) return <p className="operations-note">No registrations yet.</p>
  return <ul className="admin-webinar-registrations">{registrations.map((row) => <li key={row._id}><strong>{row.name}</strong><small>{row.email}</small><span>{formatDate(row.createdAt)}</span></li>)}</ul>
}

export default function AdminWebinarsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [viewingId, setViewingId] = useState('')
  const { data: webinars = [], isLoading } = useQuery({ queryKey: ['admin-webinars'], queryFn: fetchAdminWebinars })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-webinars'] })
  const publishMutation = useMutation({ mutationFn: ({ id, isPublished }) => updateWebinar(id, { isPublished }) })
  const deleteMutation = useMutation({ mutationFn: (id) => deleteWebinar(id) })
  const act = async (fn, message) => { try { await fn(); if (message) toast.success(message); invalidate() } catch (e) { toast.error(e.message) } }
  const removeWebinar = async (webinar) => {
    if (!(await confirm({ title: 'Delete this session?', message: `“${webinar.title}” and its ${webinar.registeredCount} registration${webinar.registeredCount === 1 ? '' : 's'} will be permanently deleted.`, confirmLabel: 'Delete session' }))) return
    act(() => deleteMutation.mutateAsync(webinar.id), 'Session deleted.')
  }

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">PLATFORM ADMIN</p><h1>Special courses &amp; webinars</h1><p>Time-limited sessions that disappear from the landing page once past their deadline or full.</p></div>
      {!adding && <button className="button button-primary" onClick={() => { setAdding(true); setEditingId('') }}><Plus size={16} /> New session</button>}
    </div>
    {adding && <WebinarForm onCancel={() => setAdding(false)} onDone={() => { setAdding(false); invalidate() }} />}
    <div className="admin-webinar-list">
      {isLoading ? <p className="operations-note">Loading sessions…</p>
        : !webinars.length ? <p className="operations-note"><CalendarClock size={17} /> No webinars or special courses yet.</p>
        : webinars.map((webinar) => {
          const seatsLeft = webinar.capacity != null ? webinar.capacity - webinar.registeredCount : null
          const expired = new Date(webinar.registrationDeadline ?? webinar.startsAt) < new Date()
          return <article className="admin-webinar-card" key={webinar.id}>
            {editingId === webinar.id
              ? <WebinarForm webinar={webinar} onCancel={() => setEditingId('')} onDone={() => { setEditingId(''); invalidate() }} />
              : <>
                <div className="admin-webinar-head">
                  <div><strong>{webinar.title}</strong><small>{formatDate(webinar.startsAt)}</small></div>
                  <div className="admin-status-cell">
                    <StatusPill kind={webinar.isPublished ? 'green' : 'gold'}>{webinar.isPublished ? 'Published' : 'Draft'}</StatusPill>
                    {expired && <StatusPill kind="red">Closed</StatusPill>}
                    {seatsLeft != null && <StatusPill kind={seatsLeft <= 0 ? 'red' : 'gold'}>{seatsLeft <= 0 ? 'Full' : `${seatsLeft} left`}</StatusPill>}
                  </div>
                </div>
                {webinar.description && <p className="admin-webinar-desc">{webinar.description}</p>}
                <div className="admin-row-actions">
                  <span className="admin-enroll-cell"><Users size={13} /> {webinar.registeredCount} registered</span>
                  <button className="button button-ghost button-compact" onClick={() => setViewingId(viewingId === webinar.id ? '' : webinar.id)}>{viewingId === webinar.id ? 'Hide list' : 'View registrations'}</button>
                  <button className="button button-ghost button-compact" onClick={() => act(() => publishMutation.mutateAsync({ id: webinar.id, isPublished: !webinar.isPublished }), webinar.isPublished ? 'Session unpublished.' : 'Session published.')}>{webinar.isPublished ? <><EyeOff size={14} /> Unpublish</> : <><Eye size={14} /> Publish</>}</button>
                  <button className="button button-ghost button-compact" onClick={() => { setEditingId(webinar.id); setAdding(false) }}>Edit</button>
                  <button className="button button-ghost button-compact button-danger" onClick={() => removeWebinar(webinar)}><Trash2 size={14} /> Delete</button>
                </div>
                {viewingId === webinar.id && <RegistrationsPanel webinarId={webinar.id} />}
              </>}
          </article>
        })}
    </div>
  </>
}
