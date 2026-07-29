import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Check, Eye, EyeOff, Plus, Save, Trash2, Users, X } from 'lucide-react'
import CourseBanner from '../../../components/lms/CourseBanner.jsx'
import StatusPill from '../../../components/StatusPill.jsx'
import { useConfirm } from '../../../lib/confirmContext.js'
import { useToast } from '../../../lib/toastContext.js'
import { createCourse } from '../../../lib/lms.js'
import { deleteCourse, fetchAdminCourses, fetchAdminPricing, moderateCourse, reviewCourse, updateAdminPricing } from '../../../lib/admin.js'

const courseState = (course) => (course.archivedAt ? { kind: 'red', label: 'Archived' } : course.isPublished ? { kind: 'green', label: 'Published' } : { kind: 'gold', label: 'Draft' })
const approvalState = { draft: null, pending_review: { kind: 'gold', label: 'Awaiting review' }, approved: { kind: 'green', label: 'Approved' }, rejected: { kind: 'red', label: 'Rejected' } }
const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '')
const peso = (value) => `₱${Number(value ?? 0).toLocaleString('en-PH')}`
const slugify = (value) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160)
// Pricing is tied to the 3 enrollment pathways, joined to a course purely by slug convention
// (`${pathway}-review`, see courseForPathway in index.js) — only these 3 cards get price fields.
// Broker and Agent independently editable even though they sign the same "realex-reblex"
// agreement document — that's a document-generation detail, not a pricing one.
const totalKeyBySlug = { 'broker-review': 'totalBroker', 'consultant-review': 'totalConsultant', 'agent-review': 'totalAgent' }
const upfrontKeyBySlug = { 'broker-review': 'upfrontBroker', 'consultant-review': 'upfrontConsultant', 'agent-review': 'upfrontAgent' }

// Availability dates are staged locally and only committed when "Save" is pressed — editing a
// live date field on blur risked accidental changes if an admin was just skimming the card.
function AvailabilityFields({ course, onSave }) {
  const [draft, setDraft] = useState({ availableFrom: toDateInput(course.availableFrom), availableUntil: toDateInput(course.availableUntil) })
  const saved = { availableFrom: toDateInput(course.availableFrom), availableUntil: toDateInput(course.availableUntil) }
  const dirty = draft.availableFrom !== saved.availableFrom || draft.availableUntil !== saved.availableUntil
  const mutation = useMutation({
    mutationFn: () => onSave({
      availableFrom: draft.availableFrom ? new Date(draft.availableFrom) : null,
      availableUntil: draft.availableUntil ? new Date(draft.availableUntil) : null,
    }),
  })
  return <div className="admin-course-availability">
    <span className="admin-course-field-label">Availability window</span>
    <div className="admin-season-cell">
      <label>From<input type="date" value={draft.availableFrom} onChange={(e) => setDraft((d) => ({ ...d, availableFrom: e.target.value }))} /></label>
      <label>Until<input type="date" value={draft.availableUntil} onChange={(e) => setDraft((d) => ({ ...d, availableUntil: e.target.value }))} /></label>
      {dirty && <button type="button" className="admin-season-save" onClick={() => mutation.mutate()} disabled={mutation.isPending}><Save size={12} /> {mutation.isPending ? 'Saving…' : 'Save'}</button>}
    </div>
  </div>
}

// Only rendered for the 3 pathway courses — everything else in the catalog has no price, since
// checkout is keyed off the enrollment pathway, not an arbitrary course.
function PriceField({ priceKey, label = 'Full enrollment price (PHP)', pricing, onSave }) {
  const saved = String(pricing?.[priceKey] ?? '')
  const [draft, setDraft] = useState(saved)
  const dirty = draft !== saved
  const mutation = useMutation({ mutationFn: () => onSave(priceKey, draft) })
  return <div className="admin-course-price">
    <span className="admin-course-field-label">{label}</span>
    <div className="admin-season-cell">
      <label>₱<input type="number" min={1} step={1} value={draft} onChange={(e) => setDraft(e.target.value)} /></label>
      {dirty && <button type="button" className="admin-season-save" onClick={() => mutation.mutate()} disabled={mutation.isPending}><Save size={12} /> {mutation.isPending ? 'Saving…' : 'Save'}</button>}
    </div>
    <small className="admin-course-price-current">Currently {peso(pricing?.[priceKey])}.</small>
  </div>
}

function NewCourseCard({ onCreated, onCancel }) {
  const [values, setValues] = useState({ title: '', slug: '', description: '' })
  const [touchedSlug, setTouchedSlug] = useState(false)
  const [error, setError] = useState('')
  const toast = useToast()
  const mutation = useMutation({ mutationFn: () => createCourse({ title: values.title.trim(), slug: values.slug.trim(), description: values.description.trim() || undefined }) })
  const submit = async (event) => {
    event.preventDefault()
    setError('')
    try { await mutation.mutateAsync(); toast.success('Course created.'); onCreated() } catch (e) { setError(e.message) }
  }
  return <article className="catalog-card admin-course-card admin-new-course-card">
    <form onSubmit={submit}>
      <p className="eyebrow">NEW COURSE</p>
      <input value={values.title} onChange={(event) => { const title = event.target.value; setValues((prev) => ({ ...prev, title, slug: touchedSlug ? prev.slug : slugify(title) })) }} placeholder="Course title" aria-label="Course title" autoFocus />
      <input value={values.slug} onChange={(event) => { setTouchedSlug(true); setValues((prev) => ({ ...prev, slug: slugify(event.target.value) })) }} placeholder="course-slug" aria-label="Course slug" />
      <textarea value={values.description} onChange={(event) => setValues((prev) => ({ ...prev, description: event.target.value }))} placeholder="Short description (optional)" rows={3} />
      {error && <span className="builder-error">{error}</span>}
      <div className="admin-course-actions">
        <button type="submit" className="button button-primary button-compact" disabled={mutation.isPending || values.title.trim().length < 2}><Plus size={14} /> {mutation.isPending ? 'Creating…' : 'Create course'}</button>
        <button type="button" className="button button-ghost button-compact" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  </article>
}

function CourseCard({ course, index, pricing, onAct, onUnpublish, onArchive, onReview, onRemove, onSavePrice }) {
  const state = courseState(course)
  const approval = approvalState[course.approvalStatus]
  const totalKey = totalKeyBySlug[course.slug]
  const upfrontKey = upfrontKeyBySlug[course.slug]
  return <article className="catalog-card admin-course-card">
    <CourseBanner course={course} index={index} />
    <div>
      <div className="admin-course-card-head">
        <div><h2>{course.title}</h2><small>/{course.slug} · {course.moduleCount} modules</small></div>
        <span className="admin-enroll-cell"><Users size={13} /> {course.enrolledCount}
          <button type="button" className="admin-count-toggle" title={course.showEnrollmentCount ? 'Shown on the landing page — click to hide' : 'Hidden from the landing page — click to show'} onClick={() => onAct(course, { showEnrollmentCount: !course.showEnrollmentCount }, course.showEnrollmentCount ? 'Enrollment count hidden from the landing page.' : 'Enrollment count is now shown on the landing page.')}>{course.showEnrollmentCount ? <Eye size={13} /> : <EyeOff size={13} />}</button>
        </span>
      </div>
      <div className="admin-status-cell"><StatusPill kind={state.kind}>{state.label}</StatusPill>{approval && <StatusPill kind={approval.kind}>{approval.label}</StatusPill>}</div>

      {totalKey && <div className="admin-course-price-pair">
        <PriceField priceKey={totalKey} label="Full enrollment price (PHP)" pricing={pricing} onSave={onSavePrice} />
        <PriceField priceKey={upfrontKey} label="Upfront reservation fee (PHP)" pricing={pricing} onSave={onSavePrice} />
      </div>}
      <AvailabilityFields course={course} onSave={(updates) => onAct(course, updates, 'Availability updated.')} />

      {course.approvalStatus === 'pending_review' && <div className="admin-course-actions">
        <button type="button" className="button button-primary button-compact" onClick={() => onReview(course, 'approved')}><Check size={14} /> Approve</button>
        <button type="button" className="button button-ghost button-compact" onClick={() => onReview(course, 'rejected')}><X size={14} /> Reject</button>
      </div>}
      <div className="admin-course-actions">
        {course.isPublished
          ? <button type="button" className="button button-ghost button-compact" onClick={() => onUnpublish(course)}><EyeOff size={14} /> Unpublish</button>
          : <button type="button" className="button button-ghost button-compact" onClick={() => onAct(course, { isPublished: true }, `“${course.title}” was published.`)}><Eye size={14} /> Publish</button>}
        {course.archivedAt
          ? <button type="button" className="button button-ghost button-compact" onClick={() => onAct(course, { archived: false }, `“${course.title}” was restored.`)}><ArchiveRestore size={14} /> Restore</button>
          : <button type="button" className="button button-ghost button-compact" onClick={() => onArchive(course)}><Archive size={14} /> Archive</button>}
        <button type="button" className="button button-ghost button-compact button-danger" onClick={() => onRemove(course)}><Trash2 size={14} /> Delete</button>
      </div>
    </div>
  </article>
}

export default function AdminCoursesPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [creating, setCreating] = useState(false)
  const { data: courses = [], isLoading } = useQuery({ queryKey: ['admin-courses'], queryFn: fetchAdminCourses })
  const { data: pricing } = useQuery({ queryKey: ['admin-pricing'], queryFn: fetchAdminPricing })
  const invalidateCourses = () => queryClient.invalidateQueries({ queryKey: ['admin-courses'] })
  const moderateMutation = useMutation({ mutationFn: ({ id, updates }) => moderateCourse(id, updates) })
  const priceMutation = useMutation({ mutationFn: (next) => updateAdminPricing(next) })

  const act = async (course, updates, message) => {
    try { await moderateMutation.mutateAsync({ id: course.id, updates }); if (message) toast.success(message); invalidateCourses() }
    catch (e) { toast.error(e.message) }
  }
  const unpublish = async (course) => {
    if (!(await confirm({ message: `“${course.title}” will disappear from learners immediately.`, confirmLabel: 'Unpublish' }))) return
    act(course, { isPublished: false }, `“${course.title}” was unpublished.`)
  }
  const archive = async (course) => {
    if (!(await confirm({ message: `“${course.title}” will be archived and hidden from the catalog.`, confirmLabel: 'Archive' }))) return
    act(course, { archived: true }, `“${course.title}” was archived.`)
  }
  const review = async (course, decision) => {
    if (decision === 'rejected') {
      const note = window.prompt('Reason for rejecting (shown to the instructor):')
      if (note === null) return
      try { await reviewCourse(course.id, decision, note); toast.success(`“${course.title}” was rejected.`); invalidateCourses() } catch (e) { toast.error(e.message) }
      return
    }
    try { await reviewCourse(course.id, decision); toast.success(`“${course.title}” was approved.`); invalidateCourses() } catch (e) { toast.error(e.message) }
  }
  const remove = async (course) => {
    if (!(await confirm({ title: 'Delete this course?', message: `“${course.title}” and all its modules, lessons, assignments and quizzes will be permanently deleted.`, confirmLabel: 'Delete course' }))) return
    try { await deleteCourse(course.id); toast.success(`“${course.title}” was deleted.`); invalidateCourses() } catch (e) { toast.error(e.message) }
  }
  const savePrice = async (priceKey, value) => {
    try {
      await priceMutation.mutateAsync({ ...pricing, [priceKey]: value })
      toast.success('Price updated.')
      queryClient.invalidateQueries({ queryKey: ['admin-pricing'] })
    } catch (e) { toast.error(e.message) }
  }

  const pendingReview = courses.filter((course) => course.approvalStatus === 'pending_review')

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">PLATFORM ADMIN</p><h1>Course Catalog &amp; Pricing</h1><p>Create courses, approve, publish, schedule availability, and set each pathway's price — all in one place.</p></div>
      {!creating && <button type="button" className="button button-primary" onClick={() => setCreating(true)}><Plus size={15} /> New course</button>}
    </div>
    {pendingReview.length > 0 && <div className="admin-bulkbar"><span>{pendingReview.length} course{pendingReview.length === 1 ? '' : 's'} awaiting your approval:</span>
      {pendingReview.map((course) => <span className="admin-review-chip" key={course.id}>
        <strong>{course.title}</strong>
        <button className="button button-primary button-compact" onClick={() => review(course, 'approved')}><Check size={13} /> Approve</button>
        <button className="button button-ghost button-compact" onClick={() => review(course, 'rejected')}><X size={13} /> Reject</button>
      </span>)}
    </div>}

    <div className="catalog-grid admin-course-grid">
      {creating && <NewCourseCard onCreated={() => { setCreating(false); invalidateCourses() }} onCancel={() => setCreating(false)} />}
      {isLoading ? <p className="operations-note">Loading catalog…</p>
        : !courses.length && !creating ? <p className="operations-note">No courses have been created yet.</p>
        : courses.map((course, index) => <CourseCard key={course.id} course={course} index={index} pricing={pricing} onAct={act} onUnpublish={unpublish} onArchive={archive} onReview={review} onRemove={remove} onSavePrice={savePrice} />)}
    </div>
    <p className="operations-note"><Users size={17} /> The eye toggle controls whether that course’s live enrolled count appears on the public landing page. Only Broker, Consultant, and Agent Review show a price field — pricing follows the enrollment pathway, not arbitrary courses.</p>
  </>
}
