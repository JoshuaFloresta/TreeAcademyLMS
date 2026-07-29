import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { useToast } from '../../../lib/toastContext.js'
import { PERMISSION_CATALOG, fetchPermissions, savePermissions } from '../../../lib/admin.js'

const roles = ['learner', 'instructor', 'admin']
const roleLabels = { learner: 'Learner', instructor: 'Instructor', admin: 'Admin' }

export default function AdminRolesPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [draft, setDraft] = useState(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const { data, isLoading } = useQuery({ queryKey: ['admin-permissions'], queryFn: fetchPermissions })
  // The query result is the source of truth; a local draft only exists once the admin edits it.
  const matrix = draft ?? data

  const saveMutation = useMutation({ mutationFn: savePermissions })
  const toggle = (role, key) => setDraft(() => {
    const current = draft ?? data
    const has = current[role].includes(key)
    return { ...current, [role]: has ? current[role].filter((value) => value !== key) : [...current[role], key] }
  })
  const save = async () => {
    setNotice(''); setError('')
    try { await saveMutation.mutateAsync(matrix); queryClient.invalidateQueries({ queryKey: ['admin-permissions'] }); setDraft(null); setNotice('Permissions saved.'); toast.success('Permissions saved.') }
    catch (e) { setError(e.message); toast.error(e.message) }
  }

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">PLATFORM ADMIN</p><h1>Roles &amp; Permissions</h1><p>Define what each role can access across the platform.</p></div>
      <button className="button button-primary" onClick={save} disabled={!matrix || saveMutation.isPending}>{saveMutation.isPending ? 'Saving…' : 'Save changes'}</button>
    </div>
    <div className="settings-card"><span className="notice-icon gold"><ShieldCheck size={18} /></span><div><h2>Capability matrix</h2><p>These flags document and gate what each role may do. Server routes always enforce the admin/staff boundary regardless of this matrix.</p></div></div>
    {notice && <p className="auth-notice" role="status">{notice}</p>}
    {error && <p className="form-alert" role="alert">{error}</p>}
    {isLoading || !matrix ? <p className="operations-note">Loading permissions…</p> : <div className="admin-matrix">
      <div className="admin-matrix-head"><span>CAPABILITY</span>{roles.map((role) => <span key={role}>{roleLabels[role]}</span>)}</div>
      {PERMISSION_CATALOG.map((permission) => <div className="admin-matrix-row" key={permission.key}>
        <span><strong>{permission.label}</strong><small>{permission.key}</small></span>
        {roles.map((role) => <span key={role}><input type="checkbox" aria-label={`${roleLabels[role]} — ${permission.label}`} checked={matrix[role].includes(permission.key)} onChange={() => toggle(role, permission.key)} /></span>)}
      </div>)}
    </div>}
  </>
}
