import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Check, Eye, EyeOff, FileText, Link2, Pencil, Plus, Save, Trash2, Upload, Users, X } from 'lucide-react'
import CourseBanner from '../../../components/lms/CourseBanner.jsx'
import StatusPill from '../../../components/StatusPill.jsx'
import Modal from '../../../components/Modal.jsx'
import { useConfirm } from '../../../lib/confirmContext.js'
import { useToast } from '../../../lib/toastContext.js'
import { createCourse, deleteCourseAgreementTemplate, fetchCourseAgreementEnrollments, updateCourse, uploadCourseAgreementTemplate } from '../../../lib/lms.js'
import { deleteCourse, fetchAdminCourses, fetchAdminPricing, moderateCourse, openCourseAgreementDocument, reviewCourse, updateAdminPricing } from '../../../lib/admin.js'
import Loading from '../../../components/Loading.jsx'

const courseState = (course) => (course.archivedAt ? { kind: 'red', label: 'Archived' } : course.isPublished ? { kind: 'green', label: 'Published' } : { kind: 'gold', label: 'Draft' })
const approvalState = { draft: null, pending_review: { kind: 'gold', label: 'Awaiting review' }, approved: { kind: 'green', label: 'Approved' }, rejected: { kind: 'red', label: 'Rejected' } }
const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '')
const peso = (value) => `₱${Number(value ?? 0).toLocaleString('en-PH')}`
const slugify = (value) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160)
// Pricing is tied to the 3 enrollment pathways, joined to a course purely by slug convention
// (`${pathway}-review`, see courseForPathway in index.js) — only these 3 cards get price fields.
// Broker and Appraiser independently editable even though they sign the same "realex-reblex"
// agreement document — that's a document-generation detail, not a pricing one.
const totalKeyBySlug = { 'broker-review': 'totalBroker', 'consultant-review': 'totalConsultant', 'appraiser-review': 'totalAppraiser' }
const upfrontKeyBySlug = { 'broker-review': 'upfrontBroker', 'consultant-review': 'upfrontConsultant', 'appraiser-review': 'upfrontAppraiser' }
const discountKeyBySlug = { 'broker-review': 'payInFullDiscountBroker', 'consultant-review': 'payInFullDiscountConsultant', 'appraiser-review': 'payInFullDiscountAppraiser' }

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

// The automatic "pay in full" discount's per-pathway amount — same save-on-its-own-field pattern
// as PriceField, just living next to it on the same course card since it's another figure tied to
// that pathway's price. The discount TYPE (percent vs. fixed) is shared across all 3 pathways and
// lives in the Payment Plans panel above, since it's not a per-course setting.
function DiscountField({ priceKey, pricing, onSave }) {
  const unit = pricing?.payInFullDiscountType === 'fixed' ? '₱' : '%'
  const saved = String(pricing?.[priceKey] ?? '')
  const [draft, setDraft] = useState(saved)
  const dirty = draft !== saved
  const mutation = useMutation({ mutationFn: () => onSave(priceKey, draft) })
  return <div className="admin-course-price">
    <span className="admin-course-field-label">Pay-in-full discount ({unit})</span>
    <div className="admin-season-cell">
      <label>{unit}<input type="number" min={0} max={pricing?.payInFullDiscountType === 'percent' ? 100 : undefined} step={pricing?.payInFullDiscountType === 'percent' ? 1 : 100} value={draft} onChange={(e) => setDraft(e.target.value)} /></label>
      {dirty && <button type="button" className="admin-season-save" onClick={() => mutation.mutate()} disabled={mutation.isPending}><Save size={12} /> {mutation.isPending ? 'Saving…' : 'Save'}</button>}
    </div>
    <small className="admin-course-price-current">{unit === '₱' ? `Currently ${peso(pricing?.[priceKey])}` : `Currently ${Number(pricing?.[priceKey] ?? 0)}%`} off when paid in full — no code needed.</small>
  </div>
}

// Global, not per-course — the discount TYPE shared by all 3 pathways (each pathway's own amount
// lives on its course card, see DiscountField), the installment schedule offered on the "pay
// upfront only" plan, and an optional fixed start date for that schedule.
// `draft` only ever accumulates the fields actually touched here — never a spread of the whole
// `pricing` prop — so Save sends a true partial patch. Spreading `pricing` into the draft used to
// mean saving one field could silently revert some OTHER field to whatever this browser tab had
// cached, if that field had just been changed elsewhere moments before this save fired.
function PaymentPlanSettings({ pricing, onSave }) {
  const [draft, setDraft] = useState({})
  const mutation = useMutation({ mutationFn: () => onSave(draft) })
  if (!pricing) return null
  const value = { ...pricing, ...draft }
  const dirty = Object.keys(draft).some((key) => key === 'installmentStartDate' ? toDateInput(draft[key]) !== toDateInput(pricing[key]) : String(draft[key]) !== String(pricing[key]))
  const set = (key, val) => setDraft((current) => ({ ...current, [key]: val }))
  return <div className="admin-payment-plans">
    <h2>Payment plans</h2>
    <p className="operations-note">These apply automatically at checkout — no code needed. Pay in full: instant discount (suppressed if a voucher was also used). Pay upfront fee only: the rest becomes a staff-tracked installment schedule.</p>
    <div className="admin-payment-plans-grid">
      <div className="admin-course-price">
        <span className="admin-course-field-label">Pay-in-full discount type</span>
        <div className="admin-season-cell">
          <select value={value.payInFullDiscountType} onChange={(e) => set('payInFullDiscountType', e.target.value)}>
            <option value="percent">Percent off</option>
            <option value="fixed">Fixed peso amount off</option>
          </select>
        </div>
      </div>
      <div className="admin-course-price">
        <span className="admin-course-field-label">Installments &amp; spacing</span>
        <div className="admin-season-cell">
          <label>Payments<input type="number" min={1} max={12} value={value.installmentCount} onChange={(e) => set('installmentCount', e.target.value)} /></label>
          <label>Every N days<input type="number" min={1} max={365} value={value.installmentIntervalDays} onChange={(e) => set('installmentIntervalDays', e.target.value)} /></label>
        </div>
      </div>
      <div className="admin-course-price">
        <span className="admin-course-field-label">Installment start date</span>
        <div className="admin-season-cell">
          <label>Fixed date (optional)<input type="date" value={toDateInput(value.installmentStartDate)} onChange={(e) => set('installmentStartDate', e.target.value || null)} /></label>
        </div>
        <small className="admin-course-price-current">{value.installmentStartDate ? 'Every upfront-plan learner’s schedule is anchored to this date, regardless of when they pay.' : 'Left blank: each learner’s schedule counts from their own payment date.'}</small>
      </div>
    </div>
    <p className="admin-payment-plans-pointer">↓ Each pathway's discount amount is set on its own course card below, in the “Pricing &amp; payment plan” box.</p>
    {dirty && <div className="admin-course-actions">
      <button type="button" className="button button-primary button-compact" onClick={() => mutation.mutate()} disabled={mutation.isPending}><Save size={14} /> {mutation.isPending ? 'Saving…' : 'Save payment plan settings'}</button>
      <button type="button" className="button button-ghost button-compact" onClick={() => setDraft({})}>Cancel</button>
    </div>}
  </div>
}

function NewCourseCard({ onCreated, onCancel }) {
  const [values, setValues] = useState({ title: '', slug: '', description: '' })
  const [touchedSlug, setTouchedSlug] = useState(false)
  const [templateFile, setTemplateFile] = useState(null)
  const [error, setError] = useState('')
  const toast = useToast()
  const mutation = useMutation({ mutationFn: () => createCourse({ title: values.title.trim(), slug: values.slug.trim(), description: values.description.trim() || undefined }) })
  const submit = async (event) => {
    event.preventDefault()
    setError('')
    try {
      const course = await mutation.mutateAsync()
      if (templateFile) {
        try { await uploadCourseAgreementTemplate(course.id, templateFile) }
        catch (e) { toast.error(`Course created, but the agreement PDF could not be attached: ${e.message}`) }
      }
      toast.success('Course created.')
      onCreated()
    } catch (e) { setError(e.message) }
  }
  return <article className="catalog-card admin-course-card admin-new-course-card">
    <form onSubmit={submit}>
      <p className="eyebrow">NEW COURSE</p>
      <input value={values.title} onChange={(event) => { const title = event.target.value; setValues((prev) => ({ ...prev, title, slug: touchedSlug ? prev.slug : slugify(title) })) }} placeholder="Course title" aria-label="Course title" autoFocus />
      <input value={values.slug} onChange={(event) => { setTouchedSlug(true); setValues((prev) => ({ ...prev, slug: slugify(event.target.value) })) }} placeholder="course-slug" aria-label="Course slug" />
      <textarea value={values.description} onChange={(event) => setValues((prev) => ({ ...prev, description: event.target.value }))} placeholder="Short description (optional)" rows={3} />
      <label className="admin-agreement-upload-label">
        <span>Commitment / agreement PDF (optional)</span>
        <input type="file" accept="application/pdf" onChange={(event) => setTemplateFile(event.target.files?.[0] ?? null)} />
      </label>
      {templateFile && <small className="admin-agreement-filename"><FileText size={12} /> {templateFile.name}</small>}
      {error && <span className="builder-error">{error}</span>}
      <div className="admin-course-actions">
        <button type="submit" className="button button-primary button-compact" disabled={mutation.isPending || values.title.trim().length < 2}><Plus size={14} /> {mutation.isPending ? 'Creating…' : 'Create course'}</button>
        <button type="button" className="button button-ghost button-compact" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  </article>
}

// Shown only on courses outside the 3 fixed enrollment pathways (which keep their own hardcoded
// realex-reblex/reclex documents) — lets an admin attach/replace/remove the PDF that powers that
// course's generic, no-payment application flow at /apply/:slug, and see who has signed it.
function AgreementSection({ course }) {
  const toast = useToast()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const fileInputRef = useRef(null)
  const [applicantsOpen, setApplicantsOpen] = useState(false)
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-courses'] })
  const uploadMutation = useMutation({ mutationFn: (file) => uploadCourseAgreementTemplate(course.id, file) })
  const removeMutation = useMutation({ mutationFn: () => deleteCourseAgreementTemplate(course.id) })
  const { data: applicants = [], isLoading } = useQuery({
    queryKey: ['course-agreement-enrollments', course.id],
    queryFn: () => fetchCourseAgreementEnrollments(course.id),
    enabled: applicantsOpen,
  })

  const template = course.agreementTemplate
  const applyLink = `${window.location.origin}/apply/${course.slug}`

  const chooseFile = () => fileInputRef.current?.click()
  const onFileChosen = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try { await uploadMutation.mutateAsync(file); toast.success('Agreement PDF attached.'); invalidate() }
    catch (e) { toast.error(e.message) }
  }
  const remove = async () => {
    if (!(await confirm({ message: 'Learners will no longer be able to apply with this document. Signed copies already on file are kept.', confirmLabel: 'Remove' }))) return
    try { await removeMutation.mutateAsync(); toast.success('Agreement PDF removed.'); invalidate() }
    catch (e) { toast.error(e.message) }
  }
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(applyLink); toast.success('Apply link copied.') }
    catch { toast.error('Could not copy the link.') }
  }
  const viewDocument = (courseEnrollmentId) => openCourseAgreementDocument(courseEnrollmentId).catch((e) => toast.error(e.message))

  return <div className="admin-course-agreement">
    <input ref={fileInputRef} type="file" accept="application/pdf" hidden onChange={onFileChosen} />
    {template
      ? <>
        <span className="admin-course-field-label">Agreement PDF</span>
        <div className="admin-agreement-row"><FileText size={13} /> {template.originalName}
          <button type="button" className="admin-count-toggle" title="Replace the PDF" onClick={chooseFile}><Upload size={12} /></button>
          <button type="button" className="admin-count-toggle" title="Remove the PDF" onClick={remove}><Trash2 size={12} /></button>
        </div>
        <div className="admin-agreement-row">
          <button type="button" className="button button-ghost button-compact" onClick={copyLink}><Link2 size={13} /> Copy apply link</button>
          <button type="button" className="button button-ghost button-compact" onClick={() => setApplicantsOpen(true)}><Users size={13} /> Applicants{applicants.length ? ` (${applicants.length})` : ''}</button>
        </div>
      </>
      : <button type="button" className="button button-ghost button-compact" onClick={chooseFile}><Upload size={13} /> Upload agreement PDF</button>}

    <Modal open={applicantsOpen} onClose={() => setApplicantsOpen(false)} labelledBy="agreement-applicants-title" className="confirm-modal">
      <p className="eyebrow">APPLICANTS</p>
      <h2 id="agreement-applicants-title">{course.title}</h2>
      {isLoading ? <Loading label="Loading applicants…" />
        : !applicants.length ? <p className="operations-note">No one has applied yet.</p>
        : <ul className="admin-agreement-applicant-list">{applicants.map((row) => <li key={row._id}>
          <span>{row.applicant.name} <small>{row.applicant.email}</small></span>
          <button type="button" className="button button-ghost button-compact" onClick={() => viewDocument(row._id)}><FileText size={13} /> View PDF</button>
        </li>)}</ul>}
    </Modal>
  </div>
}

// Renaming edits the title only — the slug stays fixed because pricing and checkout join a course
// to its enrollment pathway by slug (`${pathway}-review`), so an editable slug would silently
// detach both. The slug stays visible under the name so it's clear what didn't change.
// `slugLocked` is true only for the 3 pathway courses — their slug is how pricing, checkout, and
// access-provisioning find the right course (`${pathway}-review`), so it can't be edited here; the
// server enforces this too (see RESERVED_COURSE_SLUGS in index.js), this just avoids offering an
// edit that would always be rejected.
function CourseTitle({ course, slugLocked, onRenamed }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(course.title)
  const [editingSlug, setEditingSlug] = useState(false)
  const [slugDraft, setSlugDraft] = useState(course.slug)
  const toast = useToast()
  const mutation = useMutation({ mutationFn: (title) => updateCourse(course.id, { title }) })
  const slugMutation = useMutation({ mutationFn: (slug) => updateCourse(course.id, { slug }) })
  const cancel = () => { setDraft(course.title); setEditing(false) }
  const save = async (event) => {
    event.preventDefault()
    const title = draft.trim()
    if (title === course.title) return cancel()
    try { await mutation.mutateAsync(title); toast.success(`Renamed to “${title}”.`); setEditing(false); onRenamed() }
    catch (e) { toast.error(e.message) }
  }
  const cancelSlug = () => { setSlugDraft(course.slug); setEditingSlug(false) }
  const saveSlug = async (event) => {
    event.preventDefault()
    const slug = slugify(slugDraft)
    if (!slug || slug === course.slug) return cancelSlug()
    try { await slugMutation.mutateAsync(slug); toast.success(`Slug changed to “/${slug}”. Update any shared apply links.`); setEditingSlug(false); onRenamed() }
    catch (e) { toast.error(e.message) }
  }
  return <div className="admin-course-title">
    {editing
      ? <form className="admin-course-rename" onSubmit={save}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') cancel() }} aria-label="Course name" maxLength={160} autoFocus />
        <button type="submit" className="admin-season-save" disabled={mutation.isPending || draft.trim().length < 2}><Save size={12} /> {mutation.isPending ? 'Saving…' : 'Save'}</button>
        <button type="button" className="admin-count-toggle" title="Cancel" onClick={cancel}><X size={13} /></button>
      </form>
      : <h2>{course.title}<button type="button" className="admin-count-toggle" title="Rename this course" onClick={() => setEditing(true)}><Pencil size={12} /></button></h2>}
    {editingSlug
      ? <form className="admin-course-rename admin-course-slug-edit" onSubmit={saveSlug}>
        <span>/</span>
        <input value={slugDraft} onChange={(event) => setSlugDraft(slugify(event.target.value))} onKeyDown={(event) => { if (event.key === 'Escape') cancelSlug() }} aria-label="Course slug" maxLength={160} autoFocus />
        <button type="submit" className="admin-season-save" disabled={slugMutation.isPending || slugDraft.trim().length < 2}><Save size={12} /> {slugMutation.isPending ? 'Saving…' : 'Save'}</button>
        <button type="button" className="admin-count-toggle" title="Cancel" onClick={cancelSlug}><X size={13} /></button>
      </form>
      : <small>/{course.slug} · {course.moduleCount} modules{!slugLocked && <button type="button" className="admin-count-toggle" title="Edit the slug" onClick={() => setEditingSlug(true)}><Pencil size={10} /></button>}</small>}
  </div>
}

function CourseCard({ course, index, pricing, onAct, onUnpublish, onArchive, onReview, onRemove, onSavePrice, onRenamed }) {
  const state = courseState(course)
  const approval = approvalState[course.approvalStatus]
  const totalKey = totalKeyBySlug[course.slug]
  const upfrontKey = upfrontKeyBySlug[course.slug]
  const discountKey = discountKeyBySlug[course.slug]
  return <article className="catalog-card admin-course-card">
    <CourseBanner course={course} index={index} />
    <div>
      <div className="admin-course-card-head">
        <CourseTitle course={course} slugLocked={Boolean(totalKey)} onRenamed={onRenamed} />
        <span className="admin-enroll-cell"><Users size={13} /> {course.enrolledCount}
          <button type="button" className="admin-count-toggle" title={course.showEnrollmentCount ? 'Shown on the landing page — click to hide' : 'Hidden from the landing page — click to show'} onClick={() => onAct(course, { showEnrollmentCount: !course.showEnrollmentCount }, course.showEnrollmentCount ? 'Enrollment count hidden from the landing page.' : 'Enrollment count is now shown on the landing page.')}>{course.showEnrollmentCount ? <Eye size={13} /> : <EyeOff size={13} />}</button>
        </span>
      </div>
      <div className="admin-status-cell"><StatusPill kind={state.kind}>{state.label}</StatusPill>{approval && <StatusPill kind={approval.kind}>{approval.label}</StatusPill>}</div>

      {totalKey && <div className="admin-course-pricing-group">
        <span className="admin-course-group-label">Pricing &amp; payment plan</span>
        <div className="admin-course-price-pair">
          <PriceField priceKey={totalKey} label="Full enrollment price (PHP)" pricing={pricing} onSave={onSavePrice} />
          <PriceField priceKey={upfrontKey} label="Upfront fee (PHP)" pricing={pricing} onSave={onSavePrice} />
        </div>
        {discountKey && <DiscountField priceKey={discountKey} pricing={pricing} onSave={onSavePrice} />}
      </div>}
      {!totalKey && <AgreementSection course={course} />}
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
  // Sends only the changed field(s), never the whole `pricing` object — PATCH /api/admin/pricing
  // merges against the database's own current row, not a client-supplied snapshot, specifically so
  // two fields saved moments apart (or two admins editing at once) can never revert each other.
  const savePrice = async (priceKey, value) => {
    try {
      await priceMutation.mutateAsync({ [priceKey]: value })
      toast.success('Price updated.')
      queryClient.invalidateQueries({ queryKey: ['admin-pricing'] })
    } catch (e) { toast.error(e.message) }
  }
  const savePricingPatch = async (patch) => {
    try {
      await priceMutation.mutateAsync(patch)
      toast.success('Payment plan settings updated.')
      queryClient.invalidateQueries({ queryKey: ['admin-pricing'] })
    } catch (e) { toast.error(e.message) }
  }

  const pendingReview = courses.filter((course) => course.approvalStatus === 'pending_review')

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">PLATFORM ADMIN</p><h1>Course Catalog &amp; Pricing</h1><p>Create courses, approve, publish, schedule availability, and set each pathway's price — all in one place.</p></div>
      {!creating && <button type="button" className="button button-primary" onClick={() => setCreating(true)}><Plus size={15} /> New course</button>}
    </div>
    <PaymentPlanSettings pricing={pricing} onSave={savePricingPatch} />
    {pendingReview.length > 0 && <div className="admin-bulkbar"><span>{pendingReview.length} course{pendingReview.length === 1 ? '' : 's'} awaiting your approval:</span>
      {pendingReview.map((course) => <span className="admin-review-chip" key={course.id}>
        <strong>{course.title}</strong>
        <button className="button button-primary button-compact" onClick={() => review(course, 'approved')}><Check size={13} /> Approve</button>
        <button className="button button-ghost button-compact" onClick={() => review(course, 'rejected')}><X size={13} /> Reject</button>
      </span>)}
    </div>}

    <div className="catalog-grid admin-course-grid">
      {creating && <NewCourseCard onCreated={() => { setCreating(false); invalidateCourses() }} onCancel={() => setCreating(false)} />}
      {isLoading ? <Loading label="Loading catalog…" />
        : !courses.length && !creating ? <p className="operations-note">No courses have been created yet.</p>
        : courses.map((course, index) => <CourseCard key={course.id} course={course} index={index} pricing={pricing} onAct={act} onUnpublish={unpublish} onArchive={archive} onReview={review} onRemove={remove} onSavePrice={savePrice} onRenamed={invalidateCourses} />)}
    </div>
    <p className="operations-note"><Users size={17} /> The eye toggle controls whether that course’s live enrolled count appears on the public landing page. Only Broker, Consultant, and Appraiser Review show a price field — pricing follows the enrollment pathway, not arbitrary courses.</p>
  </>
}
