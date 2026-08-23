import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { BookOpen, CalendarClock, Camera, ChevronDown, Download, IdCard, KeyRound, LogIn, Receipt, RefreshCw, Save, Trash2, Upload, UserPlus, Wallet } from 'lucide-react'
import StatusPill from '../../../components/StatusPill.jsx'
import Modal from '../../../components/Modal.jsx'
import ImageCropModal from '../../../components/ImageCropModal.jsx'
import PasswordInput from '../../../components/PasswordInput.jsx'
import EnrollmentDocumentLinks from '../../../components/EnrollmentDocumentLinks.jsx'
import BillingDetailModal from '../../../components/admin/BillingDetailModal.jsx'
import BalanceDueModal from '../../../components/admin/BalanceDueModal.jsx'
import { avatarSrc } from '../../../lib/api.js'
import { startImpersonation } from '../../../lib/auth.js'
import { useConfirm } from '../../../lib/confirmContext.js'
import { useToast } from '../../../lib/toastContext.js'
import Loading from '../../../components/Loading.jsx'
import {
  bulkEnrollUsers, bulkUserAction, createAdminUser, deleteAdminUser, enrollUserCourse, fetchAdminCourses, fetchAdminEnrollments,
  fetchAdminUsers, fetchInstructorTeachingCourses, fetchUserCourses, importUsers, resetAdminUserPassword, saveInstructorTeachingCourses, unenrollUserCourse, updateAdminUser, uploadAdminUserAvatar,
} from '../../../lib/admin.js'

const roleLabels = { learner: 'Learner', instructor: 'Instructor', admin: 'Admin' }
const statuses = ['active', 'inactive', 'suspended']
const statusKind = { active: 'green', invited: 'gold', inactive: 'gold', suspended: 'red' }
const formatDate = (value) => (value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never')

// Enrollment paperwork and billing moved here from Enrollment Management (which kept only the
// approve/reject/refund workflow) — a learner's documents, payment history, and balance are now
// managed alongside the rest of their account in one place.
const pathwayLabel = { broker: 'Broker Review', consultant: 'Consultant Review', appraiser: 'Appraiser Review' }
const enrollmentStatusLabel = {
  application_pending: 'Application started', documents_pending: 'Awaiting signature', documents_complete: 'Agreement signed',
  payment_pending: 'Awaiting payment', contract_pending: 'Awaiting signature', contract_signed: 'Agreement signed',
  paid_approval_pending: 'Paid · awaiting approval', approved: 'Approved', rejected: 'Rejected', refunded: 'Refunded',
}
const enrollmentPillKind = (status) => (status === 'approved' ? 'green' : status === 'rejected' || status === 'refunded' ? 'red' : status === 'paid_approval_pending' ? 'gold' : 'green')
const enrollmentRowId = (row) => row._id ?? row.id
const peso = (value) => `₱${Number(value ?? 0).toLocaleString('en-PH')}`
const formatDueDate = (value) => (value ? new Date(value).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : '')
// Drives both the toolbar filter and the compact per-row badge — one learner can hold several
// enrollments (a second pathway), so this rolls them up into the single worst-case state a glance
// at the table needs: any balance outstanding beats "settled", which beats "no enrollment on file".
const billingSummary = (rows) => {
  if (!rows.length) return { state: 'none', balance: 0 }
  const balance = rows.reduce((sum, row) => sum + Number(row.balance ?? 0), 0)
  return { state: balance > 0 ? 'due' : 'settled', balance }
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return []
  const header = lines[0].toLowerCase().split(',').map((cell) => cell.trim())
  const hasHeader = header.includes('email')
  const cols = hasHeader ? header : ['name', 'email', 'role']
  return (hasHeader ? lines.slice(1) : lines).map((line) => {
    const cells = line.split(',').map((cell) => cell.trim())
    const row = {}
    cols.forEach((col, index) => { row[col] = cells[index] })
    return { name: row.name, email: row.email, role: ['learner', 'instructor', 'admin'].includes(row.role) ? row.role : undefined }
  }).filter((row) => row.name && row.email)
}

function downloadCsv(users) {
  const header = ['name', 'email', 'username', 'role', 'status', 'lastSeenAt', 'createdAt']
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const body = users.map((user) => header.map((key) => escape(user[key])).join(',')).join('\n')
  const blob = new Blob([`${header.join(',')}\n${body}`], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `tree-academy-users-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

// Small modal replacing the native window.prompt so the temporary password field can offer a
// show/hide toggle instead of the browser's opaque prompt input.
function ResetPasswordModal({ user, onClose, onDone }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const mutation = useMutation({ mutationFn: () => resetAdminUserPassword(user.id, password) })
  const submit = async (event) => {
    event.preventDefault()
    if (password.length < 10) { setError('Use at least 10 characters.'); return }
    setError('')
    try { await mutation.mutateAsync(); onDone() } catch (e) { setError(e.message) }
  }
  return <Modal open={Boolean(user)} onClose={onClose} labelledBy="reset-password-title" className="confirm-modal">
    <p className="eyebrow">SET TEMPORARY PASSWORD</p>
    <h2 id="reset-password-title">{user?.name}</h2>
    <form className="webinar-register-form" onSubmit={submit} style={{ textAlign: 'left', marginTop: 16 }}>
      <PasswordInput autoFocus placeholder="Temporary password (min 10 characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className="confirm-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Set password'}</button></div>
    </form>
  </Modal>
}

// Per-user drawer: full profile edit, status, security, impersonation, delete, course enrollment,
// and (for learners) enrollment paperwork and billing. `enrollments` is this learner's slice of the
// page-level bulk fetch (see AdminUsersPage) — matched by email, since Enrollment has no learnerId.
function UserDetail({ user, enrollments, onChanged, onBillingChanged }) {
  const queryClient = useQueryClient()
  const [billingRow, setBillingRow] = useState(null)
  const [dueDateRow, setDueDateRow] = useState(null)
  const toast = useToast()
  const confirm = useConfirm()
  const avatarFileRef = useRef(null)
  const [resetting, setResetting] = useState(false)
  const [profile, setProfile] = useState({ name: user.name, email: user.email, username: user.username ?? '', avatarUrl: user.avatarUrl ?? '' })
  const saveMutation = useMutation({ mutationFn: (updates) => updateAdminUser(user.id, updates) })
  const avatarMutation = useMutation({ mutationFn: (file) => uploadAdminUserAvatar(user.id, file) })
  const deleteMutation = useMutation({ mutationFn: () => deleteAdminUser(user.id) })
  const { data: courses = [], isLoading: coursesLoading } = useQuery({ queryKey: ['admin-user-courses', user.id], queryFn: () => fetchUserCourses(user.id), enabled: user.role !== 'instructor' })
  const { data: teachingCourses = [], isLoading: teachingCoursesLoading } = useQuery({ queryKey: ['admin-instructor-courses', user.id], queryFn: () => fetchInstructorTeachingCourses(user.id), enabled: user.role === 'instructor' })
  const [teachingChanges, setTeachingChanges] = useState(null)
  const teachingCourseIds = teachingChanges ?? teachingCourses.filter((course) => course.assigned).map((course) => course.id)
  const enrollMutation = useMutation({ mutationFn: ({ courseId, enrolled }) => (enrolled ? unenrollUserCourse(user.id, courseId) : enrollUserCourse(user.id, courseId)) })

  const run = async (promise, message) => {
    try { const result = await promise; if (message) toast.success(message); onChanged(); return result }
    catch (error) { toast.error(error.message) }
  }
  // Only send fields the admin actually changed — resending untouched fields (e.g. a legacy
  // avatarUrl format) can fail today's stricter server validation and block an unrelated edit.
  const saveProfile = () => {
    const updates = {}
    if (profile.name !== user.name) updates.name = profile.name
    if (profile.email !== user.email) updates.email = profile.email
    const nextUsername = profile.username.trim() || null
    if (nextUsername !== (user.username ?? null)) updates.username = nextUsername
    const nextAvatarUrl = profile.avatarUrl.trim() || null
    if (nextAvatarUrl !== (user.avatarUrl ?? null)) updates.avatarUrl = nextAvatarUrl
    return run(Promise.all([
      Object.keys(updates).length ? saveMutation.mutateAsync(updates) : Promise.resolve(),
      ...(user.role === 'instructor' ? [saveInstructorTeachingCourses(user.id, teachingCourseIds)] : []),
    ]).then(([result]) => result), user.role === 'instructor' ? 'Profile and teaching courses saved.' : 'Profile updated.')
  }
  const setStatus = async (status) => {
    if (status !== 'active' && !(await confirm({ title: `${status === 'suspended' ? 'Suspend' : 'Deactivate'} this account?`, message: `${user.name} will immediately lose access and be signed out.`, confirmLabel: status === 'suspended' ? 'Suspend' : 'Deactivate' }))) return
    run(saveMutation.mutateAsync({ status }), `Status set to ${status}.`)
  }
  const forceReset = async () => {
    if (!(await confirm({ message: `${user.name} will be required to set a new password at next sign-in.`, confirmLabel: 'Force reset', danger: false }))) return
    run(saveMutation.mutateAsync({ mustChangePassword: true }), `${user.name} must set a new password at next sign-in.`)
  }
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this user?', message: `This permanently removes ${user.name}'s account, progress, and submissions. This cannot be undone.`, confirmLabel: 'Delete user' }))) return
    run(deleteMutation.mutateAsync(), `${user.name} was deleted.`)
  }
  const impersonate = async () => {
    if (!(await confirm({ message: `You'll view the app as ${user.name} until you exit impersonation.`, confirmLabel: 'Sign in as them', danger: false }))) return
    try { await startImpersonation(user.id); window.location.assign('/dashboard') }
    catch (error) { toast.error(error.message) }
  }
  const toggleCourse = async (course) => {
    if (course.enrolled && !(await confirm({ title: 'Remove course access?', message: `${user.name} will lose access to ${course.title}${course.completedModules ? ' — their progress stays on record but they can no longer continue it' : ''}.`, confirmLabel: 'Remove access' }))) return
    run(
      enrollMutation.mutateAsync({ courseId: course.id, enrolled: course.enrolled }).then(() => queryClient.invalidateQueries({ queryKey: ['admin-user-courses', user.id] })),
      `${course.enrolled ? 'Unenrolled from' : 'Enrolled in'} ${course.title}.`,
    )
  }
  const [pendingAvatarFile, setPendingAvatarFile] = useState(null)
  const uploadAvatar = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) setPendingAvatarFile(file)
  }
  const confirmAvatarCrop = async (cropped) => {
    setPendingAvatarFile(null)
    const result = await run(avatarMutation.mutateAsync(cropped), `${user.name}’s photo was updated.`)
    if (result?.avatarUrl) setProfile((current) => ({ ...current, avatarUrl: result.avatarUrl }))
  }

  return <div className="admin-user-detail">
    <div className="admin-detail-grid">
      <section>
        <h4>Profile</h4>
        <div className="admin-detail-profile">
          <button type="button" className="admin-avatar-preview" style={profile.avatarUrl ? { backgroundImage: `url(${avatarSrc(profile.avatarUrl)})` } : undefined} onClick={() => avatarFileRef.current?.click()} disabled={avatarMutation.isPending} aria-label="Upload photo">
            {!profile.avatarUrl && (user.name?.[0] ?? 'U')}
            <span className="admin-avatar-edit"><Camera size={12} /></span>
          </button>
          <input ref={avatarFileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadAvatar} hidden />
          {pendingAvatarFile && <ImageCropModal
            file={pendingAvatarFile}
            aspect={1}
            shape="circle"
            outputWidth={480}
            onCancel={() => setPendingAvatarFile(null)}
            onConfirm={confirmAvatarCrop}
          />}
          <div className="admin-field-grid">
            <label>Name<input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></label>
            <label>Email<input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></label>
            <label>Username<input value={profile.username} onChange={(e) => setProfile({ ...profile, username: e.target.value })} placeholder="optional" /></label>
            <label>Photo URL<input value={profile.avatarUrl} onChange={(e) => setProfile({ ...profile, avatarUrl: e.target.value })} placeholder="https://… or upload a photo above" /></label>
          </div>
        </div>
        <button className="button button-primary button-compact" onClick={saveProfile} disabled={saveMutation.isPending}><Save size={14} /> Save profile</button>
      </section>

      <section>
        <h4>Status &amp; security</h4>
        <div className="admin-detail-rows">
          <div><span>Account status</span><select value={statuses.includes(user.status) ? user.status : 'active'} onChange={(e) => setStatus(e.target.value)}>{statuses.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
          <div><span>Last active</span><strong>{formatDate(user.lastSeenAt)}</strong></div>
          <div><span>Joined</span><strong>{formatDate(user.createdAt)}</strong></div>
          <div><span>Must change password</span><strong>{user.mustChangePassword ? 'Yes' : 'No'}</strong></div>
        </div>
        <div className="admin-row-actions">
          <button className="button button-ghost button-compact" onClick={() => setResetting(true)}><KeyRound size={14} /> Reset password</button>
          <button className="button button-ghost button-compact" onClick={forceReset}><RefreshCw size={14} /> Force reset</button>
          <button className="button button-ghost button-compact" onClick={impersonate}><LogIn size={14} /> Impersonate</button>
          <button className="button button-ghost button-compact button-danger" onClick={remove}><Trash2 size={14} /> Delete</button>
        </div>
        <ResetPasswordModal user={resetting ? user : null} onClose={() => setResetting(false)} onDone={() => { setResetting(false); toast.success('Temporary password set — they must change it at next sign-in.') }} />
      </section>
    </div>

    <section className="admin-detail-courses">
      <h4>{user.role === 'instructor' ? 'Teaching courses' : 'Course enrollment'}</h4>
      {user.role === 'instructor' && (teachingCoursesLoading ? <Loading label="Loading available courses…" />
        : !teachingCourses.length ? <p className="operations-note">No courses exist yet.</p>
        : <><p className="operations-note">Choose courses this instructor can teach. Changes are saved only when you click <strong>Save profile</strong>.</p><div className="admin-enroll-list">{teachingCourses.map((course) => <label key={course.id} className={`admin-enroll-row ${teachingCourseIds.includes(course.id) ? 'on' : ''}`}><input type="checkbox" checked={teachingCourseIds.includes(course.id)} onChange={() => setTeachingChanges((current) => { const ids = current ?? teachingCourses.filter((item) => item.assigned).map((item) => item.id); return ids.includes(course.id) ? ids.filter((id) => id !== course.id) : [...ids, course.id] })} /><span><strong>{course.title}</strong><small>{teachingCourseIds.includes(course.id) ? 'Assigned to teach' : 'Not assigned'}</small></span><BookOpen size={15} /></label>)}</div></>)}
      {user.role !== 'instructor' && (coursesLoading ? <Loading label="Loading courses…" />
        : !courses.length ? <p className="operations-note">No courses exist yet.</p>
        : <div className="admin-enroll-list">
          {courses.map((course) => <label key={course.id} className={`admin-enroll-row ${course.enrolled ? 'on' : ''}`}>
            <input type="checkbox" checked={course.enrolled} onChange={() => toggleCourse(course)} disabled={enrollMutation.isPending} />
            <span><strong>{course.title}</strong><small>{course.enrolled ? `${course.completedModules} modules complete${course.completedAt ? ' · finished' : ''}` : 'Not enrolled'}</small></span>
            <BookOpen size={15} />
          </label>)}
        </div>)}
    </section>

    {user.role === 'learner' && <section className="admin-detail-billing">
      <h4>Enrollment &amp; billing</h4>
      {!enrollments.length ? <p className="operations-note">No enrollment found for this email.</p>
        : enrollments.map((row) => <div className="admin-billing-row" key={enrollmentRowId(row)}>
          <div className="admin-billing-row-head">
            <span><strong>{pathwayLabel[row.applicant?.pathway] ?? row.applicant?.pathway}</strong><StatusPill kind={enrollmentPillKind(row.status)}>{enrollmentStatusLabel[row.status] ?? row.status}</StatusPill></span>
            <span className="admin-billing-figures">{peso(row.amount)} total · {peso(row.amountPaid)} paid{Number(row.balance ?? 0) > 0 && <b className="admin-billing-balance"> · {peso(row.balance)} due</b>}</span>
          </div>
          <EnrollmentDocumentLinks enrollmentId={enrollmentRowId(row)} applicantName={user.name} documents={row.documents} />
          {row.status === 'approved' && Number(row.balance ?? 0) > 0 && (row.payment?.balanceDueDate || row.payment?.balanceNote) && <p className="admin-billing-due-note">
            {row.payment?.balanceDueDate && <>Due {formatDueDate(row.payment.balanceDueDate)}. </>}{row.payment?.balanceNote}
          </p>}
          <div className="admin-row-actions">
            <button type="button" className="button button-ghost button-compact" onClick={() => setBillingRow(row)}><Receipt size={14} /> Payments</button>
            {row.status === 'approved' && Number(row.balance ?? 0) > 0 && <button type="button" className="button button-ghost button-compact" onClick={() => setDueDateRow(row)}><CalendarClock size={14} /> {row.payment?.balanceDueDate ? 'Edit due date' : 'Set due date'}</button>}
          </div>
        </div>)}
      {billingRow && <BillingDetailModal key={enrollmentRowId(billingRow)} enrollmentId={enrollmentRowId(billingRow)} name={user.name} email={user.email} pathwayTitle={pathwayLabel[billingRow.applicant?.pathway] ?? billingRow.applicant?.pathway} onClose={() => setBillingRow(null)} onChanged={onBillingChanged} />}
      {dueDateRow && <BalanceDueModal key={enrollmentRowId(dueDateRow)} row={dueDateRow} onClose={() => setDueDateRow(null)} onSaved={() => { setDueDateRow(null); onBillingChanged() }} />}
    </section>}
  </div>
}

export default function AdminUsersPage({ user }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const fileRef = useRef(null)
  const [filters, setFilters] = useState({ role: '', status: '', course: '', billing: '', search: '' })
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', email: '', username: '', role: 'learner', courseIds: [] })
  const [selected, setSelected] = useState(() => new Set())
  const [expandedId, setExpandedId] = useState('')
  const [bulkCourse, setBulkCourse] = useState('')

  const { data: allUsers = [], isLoading } = useQuery({ queryKey: ['admin-users', filters], queryFn: () => fetchAdminUsers(filters) })
  // The signed-in admin can't manage themselves here (self-edit is blocked server-side anyway,
  // and self-delete/impersonate would be nonsensical) — drop that row entirely to declutter.
  const usersExcludingSelf = allUsers.filter((row) => row.id !== user.id)
  const { data: courses = [] } = useQuery({ queryKey: ['admin-courses-min'], queryFn: fetchAdminCourses })
  // Same query key/args AdminEnrollmentsPage uses for its default (non-archived) view, so the two
  // pages share one cached fetch when visited in the same session rather than each paying for it.
  // Documents/payments/balance now live here per learner (see UserDetail's billing section) —
  // fetched in bulk once rather than per row, so expanding "Manage" never costs its own round trip.
  const { data: enrollments = [] } = useQuery({ queryKey: ['admin-enrollments', false], queryFn: () => fetchAdminEnrollments({}) })
  const enrollmentsByEmail = useMemo(() => {
    const map = new Map()
    for (const row of enrollments) {
      const email = row.applicant?.email?.toLowerCase()
      if (!email) continue
      if (!map.has(email)) map.set(email, [])
      map.get(email).push(row)
    }
    return map
  }, [enrollments])
  const enrollmentsFor = (row) => enrollmentsByEmail.get(row.email?.toLowerCase()) ?? []
  // Billing is the one filter this page can't hand to the server — it's derived from the
  // Enrollment ledger, not the User document — so it's applied client-side, after the server-side
  // role/status/course/search filters have already narrowed the list down.
  const users = filters.billing
    ? usersExcludingSelf.filter((row) => billingSummary(enrollmentsFor(row)).state === filters.billing)
    : usersExcludingSelf
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] })
  const invalidateEnrollments = () => queryClient.invalidateQueries({ queryKey: ['admin-enrollments'] })

  const createMutation = useMutation({ mutationFn: createAdminUser })
  const updateMutation = useMutation({ mutationFn: ({ id, updates }) => updateAdminUser(id, updates) })
  const bulkMutation = useMutation({ mutationFn: ({ ids, action }) => bulkUserAction(ids, action) })

  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }))
  const allIds = users.map((row) => row.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id))
  const toggle = (id) => setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  const toggleAll = () => setSelected(() => (allSelected ? new Set() : new Set(allIds)))

  const submitCreate = async (event) => {
    event.preventDefault(); setError('')
    try {
      const result = await createMutation.mutateAsync({ ...form, username: form.username.trim() || undefined, courseIds: form.role === 'instructor' ? form.courseIds : undefined })
      toast.success(`${result.user.name} created.${result.delivery === 'sent' ? ' A password-setup email was sent.' : ` Share this setup link securely: ${result.setupUrl}`}`, { duration: 9000 })
      setForm({ name: '', email: '', username: '', role: 'learner', courseIds: [] })
      invalidate()
    } catch (createError) { setError(createError.message) }
  }
  const quickUpdate = async (row, updates) => {
    if (updates.role && !(await confirm({ title: 'Change this member\'s role?', message: `${row.name} will become ${roleLabels[updates.role].toLowerCase()} — this changes what they can access across the platform.`, confirmLabel: 'Change role', danger: false }))) return
    if (updates.status && updates.status !== 'active' && !(await confirm({ title: `${updates.status === 'suspended' ? 'Suspend' : 'Deactivate'} this account?`, message: `${row.name} will immediately lose access and be signed out.`, confirmLabel: updates.status === 'suspended' ? 'Suspend' : 'Deactivate' }))) return
    try { await updateMutation.mutateAsync({ id: row.id, updates }); toast.success('Updated.'); invalidate() } catch (e) { toast.error(e.message) }
  }
  const runBulk = async (action) => {
    const ids = [...selected]
    if (!ids.length) return
    if (action === 'delete' && !(await confirm({ title: 'Delete these users?', message: `Permanently delete ${ids.length} user${ids.length === 1 ? '' : 's'}? This cannot be undone.`, confirmLabel: 'Delete' }))) return
    try { const result = await bulkMutation.mutateAsync({ ids, action }); toast.success(`${result.processed} user${result.processed === 1 ? '' : 's'} ${action}d.`); setSelected(new Set()); invalidate() }
    catch (e) { toast.error(e.message) }
  }
  const runBulkEnroll = async () => {
    const ids = [...selected]
    if (!ids.length || !bulkCourse) return
    const courseTitle = courses.find((item) => item.id === bulkCourse)?.title ?? 'this course'
    if (!(await confirm({ title: 'Enroll these learners?', message: `${ids.length} learner${ids.length === 1 ? '' : 's'} will be enrolled in ${courseTitle}.`, confirmLabel: 'Enroll', danger: false }))) return
    try { const result = await bulkEnrollUsers(ids, bulkCourse); toast.success(`Enrolled ${result.enrolled} learner${result.enrolled === 1 ? '' : 's'}.`); setSelected(new Set()) }
    catch (e) { toast.error(e.message) }
  }
  const onImportFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const rows = parseCsv(await file.text())
      if (!rows.length) { toast.error('No valid rows found. Use columns: name, email, role.'); return }
      const result = await importUsers(rows)
      toast.success(`Imported ${result.created.length} user${result.created.length === 1 ? '' : 's'}. ${result.skipped.length} skipped. Credentials were emailed where possible.`)
      invalidate()
    } catch (e) { toast.error(e.message) }
  }

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">PLATFORM ADMIN</p><h1>User Management</h1><p>Profiles, roles, status, enrollment, security, and bulk operations.</p></div>
      <div className="admin-row-actions">
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onImportFile} hidden />
        <button className="button button-ghost" onClick={() => fileRef.current?.click()}><Upload size={15} /> Import CSV</button>
        <button className="button button-ghost" onClick={() => downloadCsv(users)}><Download size={15} /> Export CSV</button>
      </div>
    </div>

    <form className="admin-form admin-create-user" onSubmit={submitCreate}>
      <span className="notice-icon gold"><UserPlus size={18} /></span>
      <input required placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <input required type="email" placeholder="Email address" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <input placeholder="Username (optional)" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
      <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, courseIds: e.target.value === 'instructor' ? form.courseIds : [] })}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      {form.role === 'instructor' && <select multiple value={form.courseIds} onChange={(e) => setForm({ ...form, courseIds: [...e.target.selectedOptions].map((option) => option.value) })} aria-label="Assign courses to instructor">{courses.map((course) => <option key={course.id ?? course._id} value={course.id ?? course._id}>{course.title}</option>)}</select>}
      <button className="button button-primary button-compact" type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? 'Creating…' : 'Create user'}</button>
    </form>

    {error && <p className="form-alert" role="alert">{error}</p>}

    <div className="admin-toolbar">
      <select value={filters.role} onChange={(e) => setFilter('role', e.target.value)}><option value="">All roles</option>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)}><option value="">All statuses</option>{['active', 'inactive', 'suspended', 'invited'].map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <select value={filters.course} onChange={(e) => setFilter('course', e.target.value)}><option value="">All courses</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select>
      <select value={filters.billing} onChange={(e) => setFilter('billing', e.target.value)}><option value="">All billing</option><option value="due">Balance due</option><option value="settled">Fully settled</option><option value="none">No enrollment</option></select>
      <input placeholder="Search name, email, username…" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
    </div>

    {selected.size > 0 && <div className="admin-bulkbar">
      <span>{selected.size} selected</span>
      <button className="button button-ghost button-compact" onClick={() => runBulk('activate')} disabled={bulkMutation.isPending}>Activate</button>
      <button className="button button-ghost button-compact" onClick={() => runBulk('deactivate')} disabled={bulkMutation.isPending}>Deactivate</button>
      <button className="button button-ghost button-compact" onClick={() => runBulk('suspend')} disabled={bulkMutation.isPending}>Suspend</button>
      <button className="button button-ghost button-compact button-danger" onClick={() => runBulk('delete')} disabled={bulkMutation.isPending}>Delete</button>
      <span className="admin-bulk-enroll"><select value={bulkCourse} onChange={(e) => setBulkCourse(e.target.value)}><option value="">Enroll in…</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select><button className="button button-primary button-compact" onClick={runBulkEnroll} disabled={!bulkCourse}>Enroll</button></span>
    </div>}

    <div className="admin-table admin-table-users">
      <div className="admin-table-head"><span>{allIds.length > 0 && <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />}</span><span>MEMBER</span><span>ROLE</span><span>STATUS</span><span>BILLING</span><span>LAST ACTIVE</span><span>ACTIONS</span></div>
      {isLoading ? <Loading label="Loading users…" />
        : !users.length ? <p className="operations-note">No users match those filters.</p>
        : users.map((row) => { const billing = billingSummary(enrollmentsFor(row)); return <div key={row.id}>
          <div className={`admin-table-row ${expandedId === row.id ? 'expanded' : ''}`}>
            <span><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} aria-label={`Select ${row.name}`} /></span>
            <span><strong>{row.name}</strong><small>{row.email}{row.username ? ` · @${row.username}` : ''}</small></span>
            <span><select value={row.role} onChange={(e) => quickUpdate(row, { role: e.target.value })}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></span>
            <span><StatusPill kind={statusKind[row.status] ?? 'green'}>{row.status}</StatusPill></span>
            {/* Rolled up from every enrollment on this email — surfaced here so an admin can spot
                who owes money without opening "Manage" first. */}
            <span>{billing.state === 'due'
              ? <span className="admin-billing-chip due"><Wallet size={12} /> {peso(billing.balance)} due</span>
              : billing.state === 'settled' ? <span className="admin-billing-chip settled">Settled</span>
              : <span className="admin-billing-chip none">—</span>}</span>
            <span>{formatDate(row.lastSeenAt)}</span>
            <span className="admin-row-actions">
              {row.status === 'active'
                ? <button className="button button-ghost button-compact" onClick={() => quickUpdate(row, { status: 'inactive' })}>Deactivate</button>
                : <button className="button button-ghost button-compact" onClick={() => quickUpdate(row, { status: 'active' })}>Activate</button>}
              {/* Opens the member's profile — their personal details and the enrollment paperwork
                  they signed, both staff-only on that page. */}
              <Link className="button button-ghost button-compact" to={`/profile?member=${row.id}`}><IdCard size={14} /> Profile</Link>
              <button className="button button-ghost button-compact" onClick={() => setExpandedId(expandedId === row.id ? '' : row.id)} aria-expanded={expandedId === row.id}>Manage <ChevronDown size={14} className={expandedId === row.id ? 'rotate' : ''} /></button>
            </span>
          </div>
          {expandedId === row.id && <UserDetail user={row} enrollments={enrollmentsFor(row)} onChanged={invalidate} onBillingChanged={invalidateEnrollments} />}
        </div> })}
    </div>
  </>
}
