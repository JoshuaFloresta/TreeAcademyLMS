import { useRef, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Award, Camera, Download, FileCheck2, KeyRound } from 'lucide-react'
import PasswordInput from '../../components/PasswordInput.jsx'
import { useToast } from '../../lib/toastContext.js'
import { avatarSrc } from '../../lib/api.js'
import { authedFetch } from '../../lib/auth.js'
import { uploadMyAvatar } from '../../lib/lms.js'
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

function ProfileEditForm({ initial, onSaved }) {
  const toast = useToast()
  const [values, setValues] = useState({ bio: initial.bio ?? '', headline: initial.headline ?? '', location: initial.location ?? '' })
  const [error, setError] = useState('')
  const mutation = useMutation({ mutationFn: () => updateProfile(values), onSuccess: () => { toast.success('Profile updated.'); onSaved() }, onError: (mutationError) => setError(mutationError.message) })
  return <div className="application-form" style={{ marginTop: 18, maxWidth: 480 }}>
    <label className="application-field"><span>Headline</span><input value={values.headline} onChange={(event) => setValues((current) => ({ ...current, headline: event.target.value }))} maxLength={120} /></label>
    <label className="application-field"><span>Location</span><input value={values.location} onChange={(event) => setValues((current) => ({ ...current, location: event.target.value }))} maxLength={120} /></label>
    <label className="application-field"><span>Bio</span><textarea value={values.bio} onChange={(event) => setValues((current) => ({ ...current, bio: event.target.value }))} maxLength={600} /></label>
    {error && <p className="form-alert">{error}</p>}
    <button type="button" className="button button-primary" disabled={mutation.isPending} onClick={() => { setError(''); mutation.mutate() }} style={{ justifySelf: 'start' }}>{mutation.isPending ? 'Saving…' : 'Save changes'}</button>
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

function AccountSettings({ user, onUserUpdate }) {
  return <>
    <div className="page-title-row"><div><p className="eyebrow">PERSONAL WORKSPACE</p><h1>Settings</h1><p>Manage the details associated with your learning account.</p></div></div>
    <div className="settings-card"><AvatarUpload name={user?.name} avatarUrl={user?.avatarUrl} onUploaded={(avatarUrl) => onUserUpdate?.({ avatarUrl })} /><div><h2>{user?.name}</h2><p>{user?.email}</p></div></div>
    <div className="settings-card" style={{ display: 'block' }}><span className="notice-icon"><KeyRound size={18} /></span><h2 style={{ margin: '10px 0 0' }}>Change password</h2><ChangePasswordForm /></div>
  </>
}

export default function SettingsPage({ page, user, onUserUpdate }) {
  const [params] = useSearchParams()
  const memberId = params.get('member')
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const viewingId = page === 'profile' ? (memberId || user?.id) : null
  const isOwnProfile = viewingId === user?.id
  const { data: profile, isLoading, error } = useQuery({ queryKey: ['user-profile', viewingId], queryFn: () => fetchUserProfile(viewingId), enabled: Boolean(viewingId) })
  const refreshProfile = () => queryClient.invalidateQueries({ queryKey: ['user-profile', viewingId] })

  if (page !== 'profile') return <AccountSettings user={user} onUserUpdate={onUserUpdate} />
  // Admins have no own-profile page — they can still open other members' profiles via ?member=.
  if (user?.role === 'admin' && !memberId) return <Navigate to="/admin/dashboard" replace />

  return <>
    <div className="page-title-row"><div><p className="eyebrow">{isOwnProfile ? 'PERSONAL WORKSPACE' : 'MEMBER PROFILE'}</p><h1>{isOwnProfile ? 'My profile' : profile?.user?.name ?? 'Profile'}</h1><p>{isOwnProfile ? 'Manage the details associated with your learning account.' : 'Viewing a Tree Academy member profile.'}</p></div></div>
    {isLoading && <div className="empty-state"><FileCheck2 size={26} /><strong>Loading profile…</strong></div>}
    {error && <div className="empty-state"><FileCheck2 size={26} /><strong>Could not load profile</strong><p>{error.message}</p></div>}
    {profile && <>
      <div className="settings-card">
        {isOwnProfile
          ? <AvatarUpload name={profile.user.name} avatarUrl={profile.user.avatarUrl} onUploaded={(avatarUrl) => { onUserUpdate?.({ avatarUrl }); refreshProfile() }} />
          : <span className="avatar sage large" style={profile.user.avatarUrl ? { backgroundImage: `url(${avatarSrc(profile.user.avatarUrl)})` } : undefined}>{!profile.user.avatarUrl && initialsOf(profile.user.name)}</span>}
        <div><h2>{profile.user.name}</h2><p>{profile.user.headline || profile.user.email}</p>{profile.user.location && <p style={{ marginTop: 3 }}>{profile.user.location}</p>}</div>
        {isOwnProfile && <button type="button" className="button button-outline" onClick={() => setEditing((current) => !current)}>{editing ? 'Cancel' : 'Edit profile'}</button>}
      </div>
      {profile.user.bio && !editing && <p style={{ maxWidth: 560, margin: '16px 0 0', color: '#5f6a60', fontSize: 12, lineHeight: 1.6 }}>{profile.user.bio}</p>}
      {isOwnProfile && editing && <ProfileEditForm initial={profile.user} onSaved={() => { setEditing(false); queryClient.invalidateQueries({ queryKey: ['user-profile', viewingId] }) }} />}

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
  </>
}
