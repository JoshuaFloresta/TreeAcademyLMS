import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { BookOpen, CalendarClock, Camera, Check, ChevronDown, Copy, Download, IdCard, KeyRound, LogIn, Mail, Receipt, RefreshCw, Save, Trash2, Upload, UserPlus, Wallet } from 'lucide-react'
import StatusPill from '../../../components/StatusPill.jsx'
import Modal from '../../../components/Modal.jsx'
import ImageCropModal from '../../../components/ImageCropModal.jsx'
import PasswordInput from '../../../components/PasswordInput.jsx'
import EnrollmentDocumentLinks from '../../../components/EnrollmentDocumentLinks.jsx'
import BillingDetailModal from '../../../components/admin/BillingDetailModal.jsx'
import BalanceDueModal from '../../../components/admin/BalanceDueModal.jsx'
import ManualBillingModal from '../../../components/admin/ManualBillingModal.jsx'
import { avatarSrc } from '../../../lib/api.js'
import { startImpersonation } from '../../../lib/auth.js'
import { useConfirm } from '../../../lib/confirmContext.js'
import { useToast } from '../../../lib/toastContext.js'
import Loading from '../../../components/Loading.jsx'
import AccessDenied from '../../../components/AccessDenied.jsx'
import {
  bulkEnrollUsers, bulkSendUserSetupEmail, bulkUserAction, createAdminRole, createAdminUser, decideEnrollment, deleteAdminUser, deleteBillingRecord, enrollUserCourse, fetchAdminCourses, fetchAdminEnrollments,
  fetchAdminRoles, fetchAdminUsers, fetchInstructorTeachingCourses, fetchUserCourses, fetchUserSetupEmailPreview, importUsers, resetAdminUserPassword, saveInstructorTeachingCourses, sendUserSetupEmail, unenrollUserCourse, updateAdminUser, uploadAdminUserAvatar,
} from '../../../lib/admin.js'

const defaultRoleLabels = { learner: 'Learner', instructor: 'Instructor', admin: 'Admin' }
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

function CreateRoleModal({ open, onClose, onCreated }) {
  const [roleName, setRoleName] = useState('')
  const [error, setError] = useState('')
  const mutation = useMutation({ mutationFn: () => createAdminRole(roleName.trim()) })

  const submit = async (event) => {
    event.preventDefault()
    const clean = roleName.trim()
    if (!clean) return
    setError('')
    try {
      const res = await mutation.mutateAsync()
      setRoleName('')
      onCreated(res.role || clean.toLowerCase().replace(/[^a-z0-9]+/g, '_'))
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <Modal open={open} onClose={() => { setRoleName(''); setError(''); onClose() }} labelledBy="create-role-title" className="confirm-modal">
      <p className="eyebrow">USER ROLES</p>
      <h2 id="create-role-title">Create new role</h2>
      <form className="webinar-register-form" onSubmit={submit} style={{ textAlign: 'left', marginTop: 16 }}>
        <input
          autoFocus
          required
          placeholder="Role name (e.g. Coordinator, Assistant)"
          value={roleName}
          onChange={(e) => setRoleName(e.target.value)}
        />
        {error && <p className="form-alert" role="alert" style={{ marginTop: 8 }}>{error}</p>}
        <div className="confirm-actions" style={{ marginTop: 16 }}>
          <button type="button" className="button button-ghost" onClick={() => { setRoleName(''); setError(''); onClose() }}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={mutation.isPending || !roleName.trim()}>
            {mutation.isPending ? 'Creating…' : 'Create role'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function SendSetupEmailModal({ user, roleOptions, onClose, onSent }) {
  const [customNote, setCustomNote] = useState('')
  const [copied, setCopied] = useState(false)
  const [sentResult, setSentResult] = useState(null)
  const [error, setError] = useState('')

  const roleLabel = roleOptions?.[user?.role] || user?.role || 'Learner'

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['setup-email-preview', user?.id, customNote],
    queryFn: () => fetchUserSetupEmailPreview(user.id, customNote),
    enabled: Boolean(user?.id),
  })

  const mutation = useMutation({
    mutationFn: () => sendUserSetupEmail(user.id, { customNote: customNote.trim() || undefined }),
  })

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const res = await mutation.mutateAsync()
      setSentResult(res)
      if (onSent) onSent(res)
    } catch (err) {
      setError(err.message)
    }
  }

  const defaultEyebrow = user?.role === 'instructor' ? 'Faculty & Instructor Portal' : user?.role === 'admin' ? 'Administrator Workspace' : 'Real Estate Review Center'
  const defaultHeadline = `Welcome to TREE Academy, ${user?.name}!`
  const defaultMessage = user?.role === 'instructor'
    ? 'You have been appointed as an instructor on the TREE Academy platform. Through the faculty portal, you can manage your assigned courses, review student submissions, conduct live review sessions, and track cohort progress.'
    : user?.role === 'admin'
      ? 'You have been granted Administrator privileges for the TREE Academy Management System. With this role, you have full access to manage users, courses, billings, and platform operations.'
      : 'Your learner account has been provisioned. You can now access your review courses, modules, mock exams, and learning dashboard.'
  const defaultAction = user?.role === 'admin'
    ? 'For security, please create a strong password for your administrator account using the secure link below. This link expires in 72 hours.'
    : user?.role === 'instructor'
      ? 'Please activate your faculty account by creating your personal password using the button below. This link is valid for 72 hours.'
      : 'To finish setting up your account and begin your review journey, please create a new password using the button below. This link is valid for 72 hours.'
  const defaultButton = user?.role === 'admin' ? 'Set Up Admin Password' : user?.role === 'instructor' ? 'Set Up Instructor Password' : 'Create My Password'

  return (
    <Modal
      open={Boolean(user)}
      onClose={() => {
        setCustomNote('')
        setSentResult(null)
        setError('')
        setCopied(false)
        onClose()
      }}
      labelledBy="send-setup-email-title"
      className="confirm-modal"
    >
      <p className="eyebrow">PASSWORD SETUP INVITATION</p>
      <h2 id="send-setup-email-title">Send setup email to {user?.name}</h2>
      <p className="enrollment-sent-lead">
        Sends an email with a secure link (valid for 72 hours) asking them to set their password, customized for their role as <strong>{roleLabel}</strong>.
      </p>

      {!sentResult ? (
        <form onSubmit={submit} style={{ textAlign: 'left', marginTop: 14 }}>
          {/* Recipient summary */}
          <div style={{
            background: '#F9F9F7',
            border: '1px solid #EAEAEA',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div>
              <strong style={{ display: 'block', color: '#1B432E' }}>{user?.name}</strong>
              <small style={{ color: '#718096' }}>{user?.email}</small>
            </div>
            <span className="admin-billing-chip settled" style={{ textTransform: 'capitalize' }}>
              {roleLabel}
            </span>
          </div>

          {/* Email Preview Card */}
          <div style={{
            border: '1px solid #E2E8F0',
            borderRadius: 8,
            overflow: 'hidden',
            marginBottom: 14,
            background: '#FFFFFF',
          }}>
            <div style={{
              background: '#1B432E',
              color: '#F9F9F7',
              padding: '10px 14px',
              textAlign: 'center',
            }}>
              <strong style={{ letterSpacing: 1.5, fontSize: 13, display: 'block' }}>TREE ACADEMY</strong>
              <small style={{ color: '#B39255', textTransform: 'uppercase', letterSpacing: 1, fontSize: 10 }}>
                {preview?.eyebrow ?? defaultEyebrow}
              </small>
            </div>
            <div style={{ height: 3, background: '#B39255' }} />
            <div style={{ padding: '14px', fontSize: 13 }}>
              <div style={{ fontSize: 11, color: '#718096', marginBottom: 4 }}>
                <strong>Subject:</strong> {preview?.subject ?? `Welcome to TREE Academy — Set up your ${roleLabel.toLowerCase()} account`}
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid #EDF2F7', margin: '8px 0' }} />
              <strong style={{ color: '#1B432E', fontSize: 14, display: 'block', marginBottom: 6 }}>
                {preview?.headline ?? defaultHeadline}
              </strong>
              <p style={{ color: '#4A5568', margin: '0 0 10px 0', lineHeight: 1.5 }}>
                {preview?.mainMessage ?? defaultMessage}
              </p>
              {customNote.trim() && (
                <div style={{ background: '#FFF9E6', borderLeft: '3px solid #B39255', padding: '8px 12px', margin: '10px 0', borderRadius: 4 }}>
                  <strong style={{ fontSize: 11, color: '#8C6D23', textTransform: 'uppercase', display: 'block', marginBottom: 2 }}>Note from Admin:</strong>
                  <span style={{ color: '#4A3A0E', fontSize: 12 }}>{customNote}</span>
                </div>
              )}
              <div style={{ background: '#F9F9F7', borderLeft: '3px solid #B39255', padding: '8px 12px', margin: '10px 0', borderRadius: 4, fontSize: 12 }}>
                <span style={{ color: '#718096', display: 'block', fontSize: 11, marginBottom: 2 }}>Access Details:</span>
                <div><strong>Portal:</strong> treeacademy.net</div>
                <div><strong>Email:</strong> {user?.email}</div>
                <div><strong>Role:</strong> <span style={{ color: '#B39255', fontWeight: 600 }}>{preview?.roleLabel ?? roleLabel}</span></div>
              </div>
              <p style={{ color: '#718096', fontSize: 11, margin: '8px 0', fontStyle: 'italic' }}>
                {preview?.actionInstructions ?? defaultAction}
              </p>
              <div style={{ textAlign: 'center', margin: '10px 0 4px 0' }}>
                <span style={{
                  display: 'inline-block',
                  background: '#1B432E',
                  color: '#F9F9F7',
                  padding: '7px 18px',
                  borderRadius: 6,
                  fontWeight: 600,
                  fontSize: 12,
                }}>
                  {preview?.buttonLabel ?? defaultButton}
                </span>
              </div>
            </div>
          </div>

          <label className="builder-field" style={{ marginBottom: 12 }}>
            <span>Personal note to recipient (optional)</span>
            <textarea
              rows={2}
              maxLength={300}
              placeholder="e.g. Welcome to Batch 1! Please set your password before our orientation."
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
            />
          </label>

          {error && <p className="form-alert" role="alert">{error}</p>}

          <div className="confirm-actions">
            <button
              type="button"
              className="button button-ghost"
              onClick={() => {
                setCustomNote('')
                setError('')
                onClose()
              }}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              type="submit"
              disabled={mutation.isPending || previewLoading}
            >
              <Mail size={14} /> {mutation.isPending ? 'Sending email…' : 'Send setup email'}
            </button>
          </div>
        </form>
      ) : (
        <div style={{ textAlign: 'left', marginTop: 14 }}>
          <div style={{
            padding: 14,
            borderRadius: 8,
            background: sentResult.delivery === 'sent' ? '#F0FFF4' : '#FFFDF5',
            border: `1px solid ${sentResult.delivery === 'sent' ? '#C6F6D5' : '#FEEBC8'}`,
            marginBottom: 16,
          }}>
            <p style={{ fontWeight: 600, color: sentResult.delivery === 'sent' ? '#22543D' : '#744210', margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Check size={16} /> {sentResult.delivery === 'sent' ? 'Password setup email sent!' : 'Setup link generated!'}
            </p>
            <p style={{ fontSize: 13, color: sentResult.delivery === 'sent' ? '#2F855A' : '#975A16', margin: '0 0 10px 0', lineHeight: 1.4 }}>
              {sentResult.delivery === 'sent'
                ? `An email customized for a ${roleLabel} was dispatched to ${user?.email}. They can click the link in their inbox to set their password.`
                : 'Email service is not configured on this server (missing Resend API key). The one-time password setup link has been generated below so you can send it to them directly:'}
            </p>
            {sentResult.setupUrl && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  readOnly
                  value={sentResult.setupUrl}
                  style={{ fontSize: 12, fontFamily: 'monospace', flex: 1, padding: '7px 10px', background: '#FFFFFF', border: '1px solid #CBD5E0', borderRadius: 4 }}
                />
                <button
                  type="button"
                  className="button button-ghost button-compact"
                  onClick={() => {
                    navigator.clipboard?.writeText(sentResult.setupUrl)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 3000)
                  }}
                >
                  <Copy size={13} /> {copied ? 'Copied!' : 'Copy link'}
                </button>
              </div>
            )}
          </div>

          <div className="confirm-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                setCustomNote('')
                setSentResult(null)
                setCopied(false)
                onClose()
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function BulkSendSetupModal({ open, selectedUsers, roleOptions, onClose, onSent }) {
  const [customNote, setCustomNote] = useState('')
  const [results, setResults] = useState(null)
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: () => bulkSendUserSetupEmail({
      ids: selectedUsers.map((u) => u.id),
      customNote: customNote.trim() || undefined,
    }),
  })

  const roleCounts = useMemo(() => {
    const counts = {}
    for (const u of selectedUsers) {
      const label = roleOptions?.[u.role] || u.role
      counts[label] = (counts[label] ?? 0) + 1
    }
    return counts
  }, [selectedUsers, roleOptions])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const res = await mutation.mutateAsync()
      setResults(res)
      if (onSent) onSent(res)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        setCustomNote('')
        setResults(null)
        setError('')
        onClose()
      }}
      labelledBy="bulk-setup-email-title"
      className="confirm-modal"
    >
      <p className="eyebrow">BULK INVITATIONS</p>
      <h2 id="bulk-setup-email-title">Send password setup emails</h2>
      <p className="enrollment-sent-lead">
        Send password creation links to <strong>{selectedUsers.length} selected user{selectedUsers.length === 1 ? '' : 's'}</strong>.
        Each recipient will automatically receive an email tailored to their role.
      </p>

      {!results ? (
        <form onSubmit={submit} style={{ textAlign: 'left', marginTop: 14 }}>
          {/* Role breakdown chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {Object.entries(roleCounts).map(([role, count]) => (
              <span key={role} className="admin-billing-chip settled" style={{ textTransform: 'capitalize' }}>
                {count} {role}{count === 1 ? '' : 's'}
              </span>
            ))}
          </div>

          {/* List of recipients */}
          <div style={{
            maxHeight: 140,
            overflowY: 'auto',
            border: '1px solid #EAEAEA',
            borderRadius: 6,
            background: '#F9F9F7',
            padding: '8px 12px',
            marginBottom: 14,
            fontSize: 12,
          }}>
            {selectedUsers.map((u) => (
              <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #EEEEEE' }}>
                <span><strong>{u.name}</strong> <small style={{ color: '#718096' }}>({u.email})</small></span>
                <span style={{ color: '#B39255', fontWeight: 600 }}>{roleOptions?.[u.role] || u.role}</span>
              </div>
            ))}
          </div>

          <label className="builder-field" style={{ marginBottom: 12 }}>
            <span>Personal note to all recipients (optional)</span>
            <textarea
              rows={2}
              maxLength={300}
              placeholder="e.g. Welcome to Tree Academy! Please set up your account before our upcoming orientation."
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
            />
          </label>

          {error && <p className="form-alert" role="alert">{error}</p>}

          <div className="confirm-actions">
            <button
              type="button"
              className="button button-ghost"
              onClick={() => {
                setCustomNote('')
                setError('')
                onClose()
              }}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              type="submit"
              disabled={mutation.isPending || !selectedUsers.length}
            >
              <Mail size={14} /> {mutation.isPending ? 'Sending emails…' : `Send to ${selectedUsers.length} user${selectedUsers.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </form>
      ) : (
        <div style={{ textAlign: 'left', marginTop: 14 }}>
          <div style={{
            padding: 14,
            borderRadius: 8,
            background: '#F0FFF4',
            border: '1px solid #C6F6D5',
            marginBottom: 16,
          }}>
            <p style={{ fontWeight: 600, color: '#22543D', margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Check size={16} /> Processed {results.processed} password setup invitation{results.processed === 1 ? '' : 's'}!
            </p>
            <p style={{ fontSize: 13, color: '#2F855A', margin: 0 }}>
              Role-customized password setup emails have been generated and dispatched to all selected recipients.
            </p>
          </div>

          <div className="confirm-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                setCustomNote('')
                setResults(null)
                onClose()
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// Per-user drawer: full profile edit, status, security, impersonation, delete, course enrollment,
// and (for learners) enrollment paperwork and billing. `enrollments` is this learner's slice of the
// page-level bulk fetch (see AdminUsersPage) — matched by email, since Enrollment has no learnerId.
function UserDetail({ user, enrollments, roleOptions, onChanged, onBillingChanged }) {
  const queryClient = useQueryClient()
  const [billingRow, setBillingRow] = useState(null)
  const [dueDateRow, setDueDateRow] = useState(null)
  const [manualBillingOpen, setManualBillingOpen] = useState(false)
  const [billingCourseId, setBillingCourseId] = useState(null)
  const toast = useToast()
  const confirm = useConfirm()
  const avatarFileRef = useRef(null)
  const [resetting, setResetting] = useState(false)
  const [setupModalOpen, setSetupModalOpen] = useState(false)
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
      enrollMutation.mutateAsync({ courseId: course.id, enrolled: course.enrolled }).then(() => {
        queryClient.invalidateQueries({ queryKey: ['admin-user-courses', user.id] })
        queryClient.invalidateQueries({ queryKey: ['admin-enrollments'] })
        queryClient.invalidateQueries({ queryKey: ['staff-billing'] })
      }),
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

  const removeBilling = async (row) => {
    const title = pathwayLabel[row.applicant?.pathway] ?? row.applicant?.pathway ?? 'this program'
    if (!(await confirm({
      title: 'Remove billing record?',
      message: `Are you sure you want to remove the billing record for ${title}? This will remove it from the learner's statement and billing records.`,
      confirmLabel: 'Remove billing',
      danger: true,
    }))) return
    try {
      await deleteBillingRecord(enrollmentRowId(row))
      toast.success('Billing record removed.')
      onBillingChanged()
    } catch (e) {
      toast.error(e.message)
    }
  }

  const approveBilling = async (row) => {
    const title = pathwayLabel[row.applicant?.pathway] ?? row.applicant?.pathway ?? 'this program'
    if (!(await confirm({
      title: 'Approve enrollment?',
      message: `Approve ${user.name}'s enrollment for ${title}?`,
      confirmLabel: 'Approve',
      danger: false,
    }))) return
    try {
      await decideEnrollment(enrollmentRowId(row), 'approved')
      toast.success('Enrollment approved.')
      onBillingChanged()
    } catch (e) {
      toast.error(e.message)
    }
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
          <button type="button" className="button button-primary button-compact" onClick={() => setSetupModalOpen(true)}><Mail size={14} /> Send setup email</button>
          <button className="button button-ghost button-compact" onClick={() => setResetting(true)}><KeyRound size={14} /> Reset password</button>
          <button className="button button-ghost button-compact" onClick={forceReset}><RefreshCw size={14} /> Force reset</button>
          <button className="button button-ghost button-compact" onClick={impersonate}><LogIn size={14} /> Impersonate</button>
          <button className="button button-ghost button-compact button-danger" onClick={remove}><Trash2 size={14} /> Delete</button>
        </div>
        <ResetPasswordModal user={resetting ? user : null} onClose={() => setResetting(false)} onDone={() => { setResetting(false); toast.success('Temporary password set — they must change it at next sign-in.') }} />
        <SendSetupEmailModal user={setupModalOpen ? user : null} roleOptions={roleOptions} onClose={() => setSetupModalOpen(false)} onSent={() => { toast.success(`Password setup email sent to ${user.name}.`) }} />
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
          {courses.map((course) => <div key={course.id} className={`admin-enroll-row ${course.enrolled ? 'on' : ''}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px' }}>
            <label style={{ display: 'flex', alignItems: 'center', flex: 1, cursor: 'pointer', gap: 12 }}>
              <input type="checkbox" checked={course.enrolled} onChange={() => toggleCourse(course)} disabled={enrollMutation.isPending} />
              <span><strong>{course.title}</strong><small>{course.enrolled ? `${course.completedModules} modules complete${course.completedAt ? ' · finished' : ''}` : 'Not enrolled'}</small></span>
            </label>
            <BookOpen size={15} />
          </div>)}
        </div>)}
    </section>

    {user.role === 'learner' && <section className="admin-detail-billing">
      <div className="admin-detail-billing-head">
        <h4>Enrollment &amp; billing</h4>
        {/* For someone added directly via Create user / CSV import rather than the public
            enrollment flow — creates a billing record with no admission form or agreement behind
            it, so payments and a balance can still be tracked against them. */}
        <button type="button" className="button button-ghost button-compact" onClick={() => { setBillingCourseId(null); setManualBillingOpen(true) }}><UserPlus size={13} /> Bill manually</button>
      </div>
      {!enrollments.length ? <p className="operations-note">No paid enrollment on record for this email — an admission form was never completed with payment, or is still in progress.</p>
        : enrollments.map((row) => <div className="admin-billing-row" key={enrollmentRowId(row)}>
          <div className="admin-billing-row-head">
            <span>
              <strong>{pathwayLabel[row.applicant?.pathway] ?? row.applicant?.pathway}</strong>
              {row.batch && <small className="admin-billing-manual-tag" style={{ marginLeft: 6 }}>{row.batch}</small>}
              <StatusPill kind={enrollmentPillKind(row.status)}>{enrollmentStatusLabel[row.status] ?? row.status}</StatusPill>
              {row.origin === 'manual' && <small className="admin-billing-manual-tag">Manually billed</small>}
            </span>
            <span className="admin-billing-figures">{peso(row.amount)} total · {peso(row.amountPaid)} paid{Number(row.balance ?? 0) > 0 && <b className="admin-billing-balance"> · {peso(row.balance)} due</b>}</span>
          </div>
          <EnrollmentDocumentLinks enrollmentId={enrollmentRowId(row)} applicantName={user.name} documents={row.documents} emptyLabel={row.origin === 'manual' ? null : undefined} />
          {row.status === 'approved' && Number(row.balance ?? 0) > 0 && (row.payment?.balanceDueDate || row.payment?.balanceNote) && <p className="admin-billing-due-note">
            {row.payment?.balanceDueDate && <>Due {formatDueDate(row.payment.balanceDueDate)}. </>}{row.payment?.balanceNote}
          </p>}
          <div className="admin-row-actions">
            {row.status === 'paid_approval_pending' && (
              <button type="button" className="button button-primary button-compact" onClick={() => approveBilling(row)}><Check size={14} /> Approve</button>
            )}
            <button type="button" className="button button-ghost button-compact" onClick={() => setBillingRow(row)}><Receipt size={14} /> Payments</button>
            {row.status === 'approved' && Number(row.balance ?? 0) > 0 && <button type="button" className="button button-ghost button-compact" onClick={() => setDueDateRow(row)}><CalendarClock size={14} /> {row.payment?.balanceDueDate ? 'Edit due date' : 'Set due date'}</button>}
            <button type="button" className="button button-ghost button-compact button-danger" onClick={() => removeBilling(row)}><Trash2 size={14} /> Remove billing</button>
          </div>
        </div>)}
      {billingRow && <BillingDetailModal key={enrollmentRowId(billingRow)} enrollmentId={enrollmentRowId(billingRow)} name={user.name} email={user.email} pathwayTitle={pathwayLabel[billingRow.applicant?.pathway] ?? billingRow.applicant?.pathway} onClose={() => setBillingRow(null)} onChanged={onBillingChanged} />}
      {dueDateRow && <BalanceDueModal key={enrollmentRowId(dueDateRow)} row={dueDateRow} onClose={() => setDueDateRow(null)} onSaved={() => { setDueDateRow(null); onBillingChanged() }} />}
      <ManualBillingModal
        open={manualBillingOpen}
        learnerId={user.id}
        learnerName={user.name}
        courses={courses}
        initialCourseId={billingCourseId}
        onClose={() => { setManualBillingOpen(false); setBillingCourseId(null) }}
        onCreated={() => {
          setManualBillingOpen(false)
          setBillingCourseId(null)
          onBillingChanged()
          queryClient.invalidateQueries({ queryKey: ['admin-user-courses', user.id] })
        }}
      />
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
  const [form, setForm] = useState({ name: '', email: '', username: '', role: 'learner', courseId: '' })
  const [selected, setSelected] = useState(() => new Set())
  const [expandedId, setExpandedId] = useState('')
  const [bulkCourse, setBulkCourse] = useState('')
  const [newRoleModalOpen, setNewRoleModalOpen] = useState(false)
  const [setupEmailUser, setSetupEmailUser] = useState(null)
  const [bulkSetupOpen, setBulkSetupOpen] = useState(false)

  const { data: serverRoles = [] } = useQuery({ queryKey: ['admin-roles'], queryFn: fetchAdminRoles })
  const roleOptions = useMemo(() => {
    const map = { ...defaultRoleLabels }
    if (Array.isArray(serverRoles)) {
      for (const r of serverRoles) {
        if (r?.role && r?.label) map[r.role] = r.label
      }
    }
    return map
  }, [serverRoles])

  const { data: allUsers = [], isLoading, isError, error: usersError, refetch } = useQuery({ queryKey: ['admin-users', filters], queryFn: () => fetchAdminUsers(filters) })
  // The signed-in admin can't manage themselves here (self-edit is blocked server-side anyway,
  // and self-delete/impersonate would be nonsensical) — drop that row entirely to declutter.
  const usersExcludingSelf = allUsers.filter((row) => row.id !== user?.id)
  const { data: courses = [] } = useQuery({ queryKey: ['admin-courses-min'], queryFn: fetchAdminCourses })
  // Same query key/args AdminEnrollmentsPage uses for its default (non-archived) view, so the two
  // pages share one cached fetch when visited in the same session rather than each paying for it.
  // Documents/payments/balance now live here per learner (see UserDetail's billing section) —
  // fetched in bulk once rather than per row, so expanding "Manage" never costs its own round trip.
  const { data: enrollments = [] } = useQuery({ queryKey: ['admin-enrollments', false], queryFn: () => fetchAdminEnrollments({}) })
  // Only show real billing records: approved enrollments, any enrollment where payments have been made,
  // or manually created billing, hiding unfinished submissions and draft applications with ₱0 paid.
  const enrollmentsByEmail = useMemo(() => {
    const map = new Map()
    for (const row of enrollments) {
      if (row.archivedAt) continue
      const isReal = row.status === 'approved' || Number(row.amountPaid ?? 0) > 0 || row.origin === 'manual'
      if (!isReal) continue
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
      const isInstructorOrLearner = form.role === 'instructor' || form.role === 'learner'
      const result = await createMutation.mutateAsync({
        ...form,
        username: form.username.trim() || undefined,
        courseId: isInstructorOrLearner && form.courseId ? form.courseId : undefined,
        courseIds: isInstructorOrLearner && form.courseId ? [form.courseId] : undefined,
      })
      toast.success(`${result.user.name} created.${result.delivery === 'sent' ? ' A password-setup email was sent.' : ` Share this setup link securely: ${result.setupUrl}`}`, { duration: 9000 })
      setForm({ name: '', email: '', username: '', role: 'learner', courseId: '' })
      invalidate()
      invalidateEnrollments()
    } catch (createError) { setError(createError.message) }
  }
  const quickUpdate = async (row, updates) => {
    const targetLabel = updates.role ? (roleOptions[updates.role] ?? updates.role) : ''
    if (updates.role && !(await confirm({ title: 'Change this member\'s role?', message: `${row.name} will become ${targetLabel.toLowerCase()} — this changes what they can access across the platform.`, confirmLabel: 'Change role', danger: false }))) return
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
      <select
        value={form.role}
        onChange={(e) => {
          if (e.target.value === '__new_role__') {
            setNewRoleModalOpen(true)
            return
          }
          setForm({
            ...form,
            role: e.target.value,
            courseId: (e.target.value === 'instructor' || e.target.value === 'learner') ? form.courseId : '',
          })
        }}
      >
        {Object.entries(roleOptions).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
        <option value="__new_role__">+ Create new role...</option>
      </select>
      {(form.role === 'instructor' || form.role === 'learner') && (
        <select
          value={form.courseId}
          onChange={(e) => setForm({ ...form, courseId: e.target.value })}
          aria-label={form.role === 'instructor' ? 'Assign teaching course' : 'Assign course'}
        >
          <option value="">{form.role === 'instructor' ? 'Assign teaching course (optional)' : 'Assign course (optional)'}</option>
          {courses.map((course) => (
            <option key={course.id ?? course._id} value={course.id ?? course._id}>
              {course.title}
            </option>
          ))}
        </select>
      )}
      <button className="button button-primary button-compact" type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? 'Creating…' : 'Create user'}</button>
    </form>

    {error && <p className="form-alert" role="alert">{error}</p>}

    <div className="admin-toolbar">
      <select value={filters.role} onChange={(e) => setFilter('role', e.target.value)}><option value="">All roles</option>{Object.entries(roleOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)}><option value="">All statuses</option>{['active', 'inactive', 'suspended', 'invited'].map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <select value={filters.course} onChange={(e) => setFilter('course', e.target.value)}><option value="">All courses</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select>
      <select value={filters.billing} onChange={(e) => setFilter('billing', e.target.value)}><option value="">All billing</option><option value="due">Balance due</option><option value="settled">Fully settled</option><option value="none">No paid enrollment</option></select>
      <input placeholder="Search name, email, username…" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
    </div>

    {selected.size > 0 && <div className="admin-bulkbar">
      <span>{selected.size} selected</span>
      <button className="button button-ghost button-compact" onClick={() => setBulkSetupOpen(true)}><Mail size={14} /> Send setup email ({selected.size})</button>
      <button className="button button-ghost button-compact" onClick={() => runBulk('activate')} disabled={bulkMutation.isPending}>Activate</button>
      <button className="button button-ghost button-compact" onClick={() => runBulk('deactivate')} disabled={bulkMutation.isPending}>Deactivate</button>
      <button className="button button-ghost button-compact" onClick={() => runBulk('suspend')} disabled={bulkMutation.isPending}>Suspend</button>
      <button className="button button-ghost button-compact button-danger" onClick={() => runBulk('delete')} disabled={bulkMutation.isPending}>Delete</button>
      <span className="admin-bulk-enroll"><select value={bulkCourse} onChange={(e) => setBulkCourse(e.target.value)}><option value="">Enroll in…</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select><button className="button button-primary button-compact" onClick={runBulkEnroll} disabled={!bulkCourse}>Enroll</button></span>
    </div>}

    <div className="admin-table admin-table-users">
      <div className="admin-table-head"><span>{allIds.length > 0 && <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />}</span><span>MEMBER</span><span>ROLE</span><span>STATUS</span><span>BILLING</span><span>LAST ACTIVE</span><span>ACTIONS</span></div>
      {isLoading ? <Loading label="Loading users…" />
        : isError ? (
            usersError?.status === 403
              ? <div style={{ padding: '20px 0' }}><AccessDenied role={user?.role} requiredRoles={['Admin']} /></div>
              : <div className="operations-note" style={{ color: '#c0392b', display: 'flex', alignItems: 'center', gap: 10, padding: '16px 0' }}>
                  <span>Failed to load users: {usersError?.message || 'Server error.'}</span>
                  <button type="button" className="button button-ghost button-compact" onClick={() => refetch()}><RefreshCw size={12} /> Retry</button>
                </div>
          )
        : !users.length ? <p className="operations-note">No users match those filters.</p>
        : users.map((row) => { const billing = billingSummary(enrollmentsFor(row)); return <div key={row.id}>
          <div className={`admin-table-row ${expandedId === row.id ? 'expanded' : ''}`}>
            <span><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} aria-label={`Select ${row.name}`} /></span>
            <span><strong>{row.name}</strong><small>{row.email}{row.username ? ` · @${row.username}` : ''}</small></span>
            <span><select value={row.role} onChange={(e) => quickUpdate(row, { role: e.target.value })}>{Object.entries(roleOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></span>
            <span><StatusPill kind={statusKind[row.status] ?? 'green'}>{row.status}</StatusPill></span>
            {/* Rolled up from every enrollment on this email — surfaced here so an admin can spot
                who owes money without opening "Manage" first. */}
            <span>{billing.state === 'due'
              ? <span className="admin-billing-chip due"><Wallet size={12} /> {peso(billing.balance)} due</span>
              : billing.state === 'settled' ? <span className="admin-billing-chip settled">Settled</span>
              : <span className="admin-billing-chip none">—</span>}</span>
            <span>{formatDate(row.lastSeenAt)}</span>
            <span className="admin-row-actions">
              <button type="button" className="button button-ghost button-compact" title="Send password setup email" onClick={() => setSetupEmailUser(row)}><Mail size={14} /> Setup email</button>
              {row.status === 'active'
                ? <button className="button button-ghost button-compact" onClick={() => quickUpdate(row, { status: 'inactive' })}>Deactivate</button>
                : <button className="button button-ghost button-compact" onClick={() => quickUpdate(row, { status: 'active' })}>Activate</button>}
              {/* Opens the member's profile — their personal details and the enrollment paperwork
                  they signed, both staff-only on that page. */}
              <Link className="button button-ghost button-compact" to={`/profile?member=${row.id}`}><IdCard size={14} /> Profile</Link>
              <button className="button button-ghost button-compact" onClick={() => setExpandedId(expandedId === row.id ? '' : row.id)} aria-expanded={expandedId === row.id}>Manage <ChevronDown size={14} className={expandedId === row.id ? 'rotate' : ''} /></button>
            </span>
          </div>
          {expandedId === row.id && <UserDetail user={row} enrollments={enrollmentsFor(row)} roleOptions={roleOptions} onChanged={invalidate} onBillingChanged={invalidateEnrollments} />}
        </div> })}
    </div>

    <CreateRoleModal
      open={newRoleModalOpen}
      onClose={() => setNewRoleModalOpen(false)}
      onCreated={(newRole) => {
        setNewRoleModalOpen(false)
        queryClient.invalidateQueries({ queryKey: ['admin-roles'] })
        setForm((prev) => ({ ...prev, role: newRole }))
        toast.success(`Role "${newRole}" created.`)
      }}
    />

    <SendSetupEmailModal
      user={setupEmailUser}
      roleOptions={roleOptions}
      onClose={() => setSetupEmailUser(null)}
      onSent={() => toast.success(`Password setup email sent to ${setupEmailUser?.name}.`)}
    />

    <BulkSendSetupModal
      open={bulkSetupOpen}
      selectedUsers={users.filter((u) => selected.has(u.id))}
      roleOptions={roleOptions}
      onClose={() => setBulkSetupOpen(false)}
      onSent={(res) => {
        toast.success(`Processed password setup emails for ${res.processed} user${res.processed === 1 ? '' : 's'}.`)
        setSelected(new Set())
      }}
    />
  </>
}
