import { useRef, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Award, CalendarDays, Camera, Download, FileCheck2, IdCard, KeyRound, MapPin, Pencil, UserRound } from 'lucide-react'
import EnrollmentDocumentLinks from '../../components/EnrollmentDocumentLinks.jsx'
import Loading from '../../components/Loading.jsx'
import PasswordInput from '../../components/PasswordInput.jsx'
import { useToast } from '../../lib/toastContext.js'
import { avatarSrc } from '../../lib/api.js'
import { authedFetch } from '../../lib/auth.js'
import { fetchCourses, uploadMyAvatar } from '../../lib/lms.js'
import ImageCropModal from '../../components/ImageCropModal.jsx'

async function requestJson(path, options) {
  const response = await authedFetch(path, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? 'That request could not be completed.')
  return data
}
const fetchUserProfile = (id) => requestJson(`/api/users/${id}`)
const updateProfile = (payload) => requestJson('/api/users/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
const changePassword = (payload) => requestJson('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })

const initialsOf = (name) => (name ?? '').trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || '?'
const pathwayLabel = { broker: 'Broker Review', consultant: 'Consultant Review', appraiser: 'Appraiser Review' }
const roleLabel = { instructor: 'Instructor', admin: 'Admin' }

// Shared self-serve avatar uploader — used on both the account card and the profile header.
function AvatarUpload({ name, avatarUrl, size = 'large', onUploaded }) {
  const toast = useToast()
  const fileRef = useRef(null)
  const [error, setError] = useState('')
  const [pendingFile, setPendingFile] = useState(null)
  const mutation = useMutation({
    mutationFn: uploadMyAvatar,
    onSuccess: (result) => { setError(''); toast.success('Photo updated.'); onUploaded(result.avatarUrl) },
    onError: (uploadError) => { setError(uploadError.message); toast.error(uploadError.message) },
  })
  const pick = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) setPendingFile(file)
  }
  return <div className="avatar-upload">
    <button type="button" className={`avatar ${size} avatar-upload-trigger`} style={avatarUrl ? { backgroundImage: `url(${avatarSrc(avatarUrl)})` } : undefined} onClick={() => fileRef.current?.click()} disabled={mutation.isPending} aria-label="Upload profile photo">
      {!avatarUrl && initialsOf(name)}
      <span className="avatar-upload-badge"><Camera size={13} /></span>
    </button>
    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} hidden />
    {error && <small className="avatar-upload-error">{error}</small>}
    {pendingFile && <ImageCropModal
      file={pendingFile}
      aspect={1}
      shape="circle"
      outputWidth={480}
      onCancel={() => setPendingFile(null)}
      onConfirm={(cropped) => { setPendingFile(null); mutation.mutate(cropped) }}
    />}
  </div>
}

async function downloadCertificate(id, name) {
  const response = await authedFetch(`/api/certificates/${id}/download`)
  if (!response.ok) return
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `Tree-Academy-Certificate-${name}.pdf`
  link.click()
  URL.revokeObjectURL(url)
}

const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '')
const formatBirthday = (value) => (value ? new Date(value).toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric' }) : null)
const joinedLabel = (value) => (value ? new Date(value).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' }) : '—')
// Read once at module load rather than per render — it only caps the birthday picker, and a
// date that changes mid-render is exactly what the purity rule exists to prevent.
const TODAY = toDateInput(Date.now())

// The profile reads as a stack of titled cards, each editable on its own. Editing one section at a
// time beats one long form: you change your school without being handed every other field, and a
// validation error names a box that's still on screen.
//
// `readOnly` fields are shown but never sent — full name and email come from the signed enrollment
// agreement and are what staff match records against, so only an admin can change them.
const SECTIONS = [
  {
    key: 'personal',
    title: 'Personal information',
    icon: IdCard,
    fields: [
      { name: 'name', label: 'Full name', readOnly: true },
      { name: 'username', label: 'Preferred name', placeholder: 'e.g. josh.cruz', maxLength: 30, hint: 'Letters, numbers, dot, underscore, or hyphen.' },
      { name: 'email', label: 'Email address', readOnly: true },
      { name: 'birthDate', label: 'Date of birth', type: 'date', private: true },
      { name: 'school', label: 'School or university', maxLength: 200 },
      { name: 'degree', label: 'Degree', maxLength: 200 },
    ],
  },
  {
    key: 'about',
    title: 'About',
    icon: UserRound,
    fields: [
      { name: 'headline', label: 'Headline', maxLength: 120, placeholder: 'e.g. Broker candidate, Batch 2027' },
      { name: 'location', label: 'Location', maxLength: 120, placeholder: 'e.g. Quezon City' },
      { name: 'facebookUrl', label: 'Facebook profile', type: 'url', maxLength: 300, placeholder: 'https://facebook.com/yourname' },
      { name: 'bio', label: 'Bio', type: 'textarea', maxLength: 600, full: true, placeholder: 'Tell the academy a little about yourself.' },
    ],
  },
]

const displayValue = (field, user) => {
  const raw = user[field.name]
  if (field.name === 'birthDate') return formatBirthday(raw)
  if (field.name === 'username') return raw ? `@${raw}` : null
  return raw || null
}

function FacebookGlyph() {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.09 24 18.1 24 12.07Z" /></svg>
}

// One card: reads as a labelled grid, flips to a form of the same shape when Edit is pressed.
function ProfileSection({ section, user, isOwnProfile, onSaved }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const editable = section.fields.filter((field) => !field.readOnly)
  const mutation = useMutation({ mutationFn: (payload) => updateProfile(payload) })

  const startEditing = () => {
    setDraft(Object.fromEntries(editable.map((field) => [field.name, field.type === 'date' ? toDateInput(user[field.name]) : (user[field.name] ?? '')])))
    setError('')
    setEditing(true)
  }
  const save = async (event) => {
    event.preventDefault()
    setError('')
    try {
      await mutation.mutateAsync(draft)
      toast.success(`${section.title} updated.`)
      setEditing(false)
      onSaved()
    } catch (e) { setError(e.message) }
  }

  // A peer viewing someone else's profile sees only the fields that have a value; on your own,
  // empty rows stay visible as "Not set", because a blank you can see is an invitation to fill it.
  const rows = section.fields.filter((field) => isOwnProfile || displayValue(field, user))
  if (!rows.length) return null

  return <section className="profile-card">
    <header className="profile-card-head">
      <h2><section.icon size={16} /> {section.title}</h2>
      {isOwnProfile && !editing && <button type="button" className="profile-edit-button" onClick={startEditing}>Edit <Pencil size={12} /></button>}
    </header>

    {editing ? <form className="profile-card-form" onSubmit={save}>
      {editable.map((field) => <label key={field.name} className={`application-field${field.full ? ' full' : ''}`}>
        <span>{field.label}</span>
        {field.type === 'textarea'
          ? <textarea value={draft[field.name]} onChange={(event) => setDraft((current) => ({ ...current, [field.name]: event.target.value }))} maxLength={field.maxLength} rows={4} placeholder={field.placeholder} />
          : <input type={field.type ?? 'text'} value={draft[field.name]} onChange={(event) => setDraft((current) => ({ ...current, [field.name]: event.target.value }))} maxLength={field.maxLength} placeholder={field.placeholder} max={field.type === 'date' ? TODAY : undefined} />}
        {field.name === 'bio' ? <small>{draft.bio.length}/{field.maxLength}</small> : field.hint && <small>{field.hint}</small>}
      </label>)}
      {section.fields.some((field) => field.readOnly) && <p className="profile-card-note">Your full name and email come from your signed enrollment agreement. Contact the academy if either needs correcting.</p>}
      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className="profile-card-actions">
        <button className="button button-primary button-compact" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save changes'}</button>
        <button type="button" className="button button-ghost button-compact" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </form>
    : <dl className="profile-card-grid">
      {rows.map((field) => {
        const value = displayValue(field, user)
        return <div key={field.name} className={field.full ? 'full' : undefined}>
          <dt>{field.label}{field.private && <span className="profile-private-tag" title="Only you and academy staff can see this">Private</span>}</dt>
          <dd className={value ? undefined : 'profile-value-empty'}>
            {field.name === 'facebookUrl' && value
              ? <a className="profile-social-link" href={value} target="_blank" rel="noopener noreferrer nofollow"><FacebookGlyph /> View profile</a>
              : value ?? 'Not set'}
          </dd>
        </div>
      })}
    </dl>}
  </section>
}

// Staff-only. Shows what this member actually submitted during enrollment, opened (or downloaded)
// through the authorized streaming route — the profile payload never contains the files or their
// storage keys.
function MemberDocuments({ name, enrollments }) {
  const rows = (enrollments ?? []).filter((row) => row.documents?.length)
  if (!rows.length) return null
  return <div className="profile-documents">
    <h2>Enrollment documents</h2>
    <p>Submitted admission form and signed agreements. Visible to academy staff only; each view is recorded in the audit log.</p>
    {rows.map((row) => <div className="profile-document-row" key={row.id}>
      <strong>{pathwayLabel[row.pathway] ?? row.pathway}</strong>
      <EnrollmentDocumentLinks enrollmentId={row.id} applicantName={name} documents={row.documents} emptyLabel={null} />
    </div>)}
  </div>
}

function ChangePasswordForm() {
  const toast = useToast()
  const [values, setValues] = useState({ currentPassword: '', newPassword: '' })
  const [notice, setNotice] = useState('')
  const [isError, setIsError] = useState(false)
  const mutation = useMutation({
    mutationFn: () => changePassword(values),
    onSuccess: () => { setIsError(false); setNotice('Password updated.'); toast.success('Password updated.'); setValues({ currentPassword: '', newPassword: '' }) },
    onError: (error) => { setIsError(true); setNotice(error.message); toast.error(error.message) },
  })
  const submit = () => {
    if (!values.currentPassword) { setIsError(true); setNotice('Enter your current password.'); return }
    if (values.newPassword.length < 10) { setIsError(true); setNotice('Your new password needs at least 10 characters.'); return }
    setNotice('')
    mutation.mutate()
  }
  return <div className="application-form" style={{ marginTop: 18, maxWidth: 380 }}>
    <label className="application-field"><span>Current password</span><PasswordInput value={values.currentPassword} onChange={(event) => setValues((current) => ({ ...current, currentPassword: event.target.value }))} /></label>
    <label className="application-field"><span>New password</span><PasswordInput value={values.newPassword} onChange={(event) => setValues((current) => ({ ...current, newPassword: event.target.value }))} minLength={10} /><small style={{ color: '#758178', fontWeight: 500 }}>At least 10 characters.</small></label>
    {notice && <p className={isError ? 'form-alert' : 'auth-notice'} role={isError ? 'alert' : undefined}>{notice}</p>}
    <button type="button" className="button button-primary" disabled={mutation.isPending} onClick={submit} style={{ justifySelf: 'start' }}>{mutation.isPending ? 'Updating…' : 'Update password'}</button>
  </div>
}

// Admins keep a standalone Settings page: they have no learner profile of their own, so there is
// nothing to merge it into. Everyone else gets the combined page below.
function AccountSettings({ user, onUserUpdate }) {
  return <>
    <div className="page-title-row"><div><p className="eyebrow">PERSONAL WORKSPACE</p><h1>Settings</h1><p>Manage the details associated with your learning account.</p></div></div>
    <div className="settings-card"><AvatarUpload name={user?.name} avatarUrl={user?.avatarUrl} onUploaded={(avatarUrl) => onUserUpdate?.({ avatarUrl })} /><div><h2>{user?.name}</h2><p>{user?.email}</p></div></div>
    <div className="settings-card" style={{ display: 'block' }}><span className="notice-icon"><KeyRound size={18} /></span><h2 style={{ margin: '10px 0 0' }}>Change password</h2><ChangePasswordForm /></div>
  </>
}

const TABS = [
  { key: 'details', label: 'Profile', icon: IdCard },
  { key: 'achievements', label: 'Achievements', icon: Award },
  { key: 'account', label: 'Account', icon: KeyRound },
]

export default function SettingsPage({ page, user, onUserUpdate }) {
  const [params] = useSearchParams()
  const memberId = params.get('member')
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('details')
  const isAdmin = user?.role === 'admin'
  // "My profile" and "Settings" are one destination now for learners and instructors, so both
  // paths resolve to the same page rather than /settings being a second, thinner version of it.
  const viewingId = memberId || user?.id
  const isOwnProfile = viewingId === user?.id
  const { data: profile, isLoading, error } = useQuery({ queryKey: ['user-profile', viewingId], queryFn: () => fetchUserProfile(viewingId), enabled: Boolean(viewingId) })
  const refreshProfile = () => queryClient.invalidateQueries({ queryKey: ['user-profile', viewingId] })
  // Own profile: /api/courses is already pathway-scoped to the learner's approved program(s) (same
  // source LmsLayout's sidebar uses, and the same query key, so this reuses that cached fetch).
  // Someone else's profile: /api/users/:id only hands staff the enrollment history, so fall back to
  // the approved pathway(s) from there instead.
  const isLearnerProfile = profile?.user?.role === 'learner'
  const { data: myCourses = [] } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses, enabled: isOwnProfile && isLearnerProfile })
  const approvedPathways = (profile?.enrollments ?? []).filter((row) => row.status === 'approved').map((row) => pathwayLabel[row.pathway] ?? row.pathway)
  const programLabel = isOwnProfile ? (myCourses.length ? myCourses.map((course) => course.title).join(' & ') : 'All-access learner')
    : (approvedPathways.length ? approvedPathways.join(' & ') : 'All-access learner')

  // Admins still land on the old Settings card when they open their own; ?member= keeps working.
  if (isAdmin && !memberId) return page === 'settings' ? <AccountSettings user={user} onUserUpdate={onUserUpdate} /> : <Navigate to="/settings" replace />
  if (!isAdmin && page === 'settings') return <Navigate to="/profile" replace />

  // Password and certificates belong to you alone — neither tab means anything on someone else's
  // profile, so a visitor sees the single Profile view with no tab strip at all.
  const tabs = isOwnProfile ? TABS.filter((entry) => entry.key !== 'achievements' || profile?.badges?.length || profile?.certificates?.length) : []
  const activeTab = isOwnProfile ? tab : 'details'

  return <>
    <div className="page-title-row"><div>
      <p className="eyebrow">{isOwnProfile ? 'PERSONAL WORKSPACE' : 'MEMBER PROFILE'}</p>
      <h1>{isOwnProfile ? 'My profile' : profile?.user?.name ?? 'Profile'}</h1>
      <p>{isOwnProfile ? 'Your details, achievements, and account security — all in one place.' : 'Viewing a Tree Academy member profile.'}</p>
    </div></div>
    {isLoading && <Loading block label="Loading profile…" />}
    {error && <div className="empty-state"><FileCheck2 size={26} /><strong>Could not load profile</strong><p>{error.message}</p></div>}
    {profile && <>
      <div className="profile-hero">
        {isOwnProfile
          ? <AvatarUpload name={profile.user.name} avatarUrl={profile.user.avatarUrl} onUploaded={(avatarUrl) => { onUserUpdate?.({ avatarUrl }); refreshProfile() }} />
          : <span className="avatar sage large" style={profile.user.avatarUrl ? { backgroundImage: `url(${avatarSrc(profile.user.avatarUrl)})` } : undefined}>{!profile.user.avatarUrl && initialsOf(profile.user.name)}</span>}
        <div className="profile-hero-identity">
          <h2>{profile.user.name}</h2>
          <p className="profile-hero-role">{isLearnerProfile ? programLabel : roleLabel[profile.user.role] ?? profile.user.role}{profile.user.username && <span className="profile-handle">@{profile.user.username}</span>}</p>
          {profile.user.headline && <p className="profile-hero-headline">{profile.user.headline}</p>}
          {profile.user.location && <p className="profile-hero-location"><MapPin size={12} /> {profile.user.location}</p>}
        </div>
        {/* The card was left-heavy with a wide empty gutter. These three facts are already in the
            payload and answer what you'd actually want at a glance about a member. */}
        <dl className="profile-hero-meta">
          <div><dt><CalendarDays size={12} /> Member since</dt><dd>{joinedLabel(profile.user.createdAt)}</dd></div>
          <div><dt><Award size={12} /> Badges</dt><dd>{String(profile.badges?.length ?? 0).padStart(2, '0')}</dd></div>
          <div><dt><FileCheck2 size={12} /> Certificates</dt><dd>{String(profile.certificates?.length ?? 0).padStart(2, '0')}</dd></div>
        </dl>
      </div>

      {tabs.length > 1 && <nav className="profile-tabs" role="tablist">
        {tabs.map((entry) => <button key={entry.key} type="button" role="tab" aria-selected={activeTab === entry.key} className={activeTab === entry.key ? 'active' : undefined} onClick={() => setTab(entry.key)}><entry.icon size={14} /> {entry.label}</button>)}
      </nav>}

      {activeTab === 'details' && <>
        {SECTIONS.map((section) => <ProfileSection key={section.key} section={section} user={profile.user} isOwnProfile={isOwnProfile} onSaved={refreshProfile} />)}
        <MemberDocuments name={profile.user.name} enrollments={profile.enrollments} />
      </>}

      {activeTab === 'achievements' && <>
        {profile.badges?.length > 0 && <div className="badge-grid">
          {profile.badges.map((award) => <article className="badge-card" key={award._id}><span className="badge-icon" style={{ background: award.badgeId?.color ?? '#B39255' }}><Award size={18} /></span><div><h3>{award.badgeId?.title}</h3><p>{award.badgeId?.description}</p></div></article>)}
        </div>}
        {profile.certificates?.length > 0 && <div className="assignment-table">
          {profile.certificates.map((certificate) => <div className="assignment-line" key={certificate._id}>
            <span className="task-check done"><FileCheck2 size={13} /></span>
            <div><strong>{certificate.templateId?.title ?? 'Certificate'}</strong><small>{certificate.templateId?.scope === 'program' ? 'Program certificate' : 'Module certificate'}</small></div>
            <span className="task-state done">{new Date(certificate.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
            <button type="button" onClick={() => downloadCertificate(certificate._id, certificate.templateId?.title ?? certificate._id)}><Download size={14} /> Download</button>
          </div>)}
        </div>}
      </>}

      {activeTab === 'account' && <section className="profile-card">
        <header className="profile-card-head"><h2><KeyRound size={16} /> Change password</h2></header>
        <ChangePasswordForm />
      </section>}
    </>}
  </>
}
