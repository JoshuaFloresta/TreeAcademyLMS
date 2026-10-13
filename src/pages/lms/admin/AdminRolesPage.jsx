import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckSquare, Plus, RefreshCw, RotateCcw, Save, Search, ShieldCheck,
  Sparkles, Square, Trash2,
} from 'lucide-react'
import Modal from '../../../components/Modal.jsx'
import Loading from '../../../components/Loading.jsx'
import { useConfirm } from '../../../lib/confirmContext.js'
import { useToast } from '../../../lib/toastContext.js'
import {
  PERMISSION_CATALOG, PERMISSION_MODULES, ROLE_PRESETS,
  createAdminRole, deleteAdminRole, fetchAdminRoles, fetchPermissions, savePermissions,
} from '../../../lib/admin.js'

const CORE_ROLES = new Set(['learner', 'instructor', 'admin'])

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
      <p className="eyebrow">ROLES &amp; PERMISSIONS</p>
      <h2 id="create-role-title">Create new role</h2>
      <p className="enrollment-sent-lead">
        Define a new custom role. Once created, you can configure its capabilities in the matrix below or assign it a preset.
      </p>
      <form className="webinar-register-form" onSubmit={submit} style={{ textAlign: 'left', marginTop: 16 }}>
        <label className="builder-field">
          <span>Role Name</span>
          <input
            autoFocus
            required
            type="text"
            placeholder="e.g. Registrar, Academic Head, Finance Officer"
            value={roleName}
            onChange={(e) => setRoleName(e.target.value)}
          />
        </label>
        {error && <p className="form-alert" role="alert">{error}</p>}
        <div className="confirm-actions">
          <button type="button" className="button button-ghost" onClick={onClose}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={mutation.isPending || !roleName.trim()}>
            {mutation.isPending ? 'Creating…' : 'Create role'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default function AdminRolesPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()

  const [draft, setDraft] = useState(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedModule, setSelectedModule] = useState('ALL')
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [presetTargetRole, setPresetTargetRole] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState('')

  const { data: serverPermissions, isLoading: permsLoading, isError: permsError, error: permsErrObj, refetch: refetchPerms } = useQuery({
    queryKey: ['admin-permissions'],
    queryFn: fetchPermissions,
  })

  const { data: serverRoles = [], isLoading: rolesLoading, isError: rolesError, error: rolesErrObj, refetch: refetchRoles } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: fetchAdminRoles,
  })

  const saveMutation = useMutation({ mutationFn: savePermissions })
  const deleteRoleMutation = useMutation({ mutationFn: deleteAdminRole })

  // Build the complete list of roles, guaranteeing learner, instructor, admin are always present
  const rolesList = useMemo(() => {
    const list = [...serverRoles]
    const existing = new Set(list.map((r) => r.role))
    if (!existing.has('admin')) list.unshift({ role: 'admin', label: 'Admin' })
    if (!existing.has('instructor')) list.push({ role: 'instructor', label: 'Instructor' })
    if (!existing.has('learner')) list.push({ role: 'learner', label: 'Learner' })
    return list
  }, [serverRoles])

  // Normalize matrix ensuring every known role has an array
  const matrix = useMemo(() => {
    const base = draft ?? serverPermissions ?? {}
    const normalized = { ...base }
    for (const r of rolesList) {
      if (!Array.isArray(normalized[r.role])) {
        normalized[r.role] = base[r.role] ?? []
      }
    }
    return normalized
  }, [draft, serverPermissions, rolesList])

  const hasDraftChanges = Boolean(draft)

  const toggle = (role, key) => {
    setDraft((current) => {
      const active = current ?? matrix
      const rolePerms = active[role] ?? []
      const has = rolePerms.includes(key)
      const nextRolePerms = has ? rolePerms.filter((v) => v !== key) : [...rolePerms, key]
      return { ...active, [role]: nextRolePerms }
    })
  }

  const setRoleAll = (role, selectAll) => {
    setDraft((current) => {
      const active = current ?? matrix
      const nextRolePerms = selectAll ? PERMISSION_CATALOG.map((p) => p.key) : []
      return { ...active, [role]: nextRolePerms }
    })
  }

  const applyPreset = (role, presetId) => {
    const preset = ROLE_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    setDraft((current) => {
      const active = current ?? matrix
      return { ...active, [role]: [...preset.permissions] }
    })
    toast.success(`Applied "${preset.name}" preset to ${role}.`)
  }

  const save = async () => {
    setNotice('')
    setError('')
    try {
      await saveMutation.mutateAsync(matrix)
      queryClient.invalidateQueries({ queryKey: ['admin-permissions'] })
      setDraft(null)
      setNotice('Roles and permissions saved successfully.')
      toast.success('Roles and permissions saved.')
    } catch (e) {
      setError(e.message)
      toast.error(e.message)
    }
  }

  const resetDraft = () => {
    setDraft(null)
    toast.info('Discarded unsaved matrix changes.')
  }

  const handleDeleteRole = async (roleObj) => {
    if (CORE_ROLES.has(roleObj.role)) {
      toast.error('System core roles cannot be deleted.')
      return
    }
    const approved = await confirm({
      title: `Delete role "${roleObj.label}"?`,
      message: `Are you sure you want to delete the "${roleObj.label}" (${roleObj.role}) role? Users must not currently be assigned to this role.`,
      confirmLabel: 'Delete role',
      danger: true,
    })
    if (!approved) return

    try {
      await deleteRoleMutation.mutateAsync(roleObj.role)
      toast.success(`Role "${roleObj.label}" was deleted.`)
      // Clean up in local draft if present
      if (draft && draft[roleObj.role]) {
        const nextDraft = { ...draft }
        delete nextDraft[roleObj.role]
        setDraft(nextDraft)
      }
      queryClient.invalidateQueries({ queryKey: ['admin-roles'] })
      queryClient.invalidateQueries({ queryKey: ['admin-permissions'] })
    } catch (e) {
      toast.error(e.message)
    }
  }

  // Filtered permission catalog based on search & module tab
  const filteredPermissions = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    return PERMISSION_CATALOG.filter((perm) => {
      const matchesSearch = !query || perm.label.toLowerCase().includes(query) || perm.key.toLowerCase().includes(query)
      const matchesModule = selectedModule === 'ALL' || perm.module === selectedModule
      return matchesSearch && matchesModule
    })
  }, [searchTerm, selectedModule])

  // Group filtered permissions by module
  const permissionsByModule = useMemo(() => {
    const groups = new Map()
    for (const perm of filteredPermissions) {
      if (!groups.has(perm.module)) groups.set(perm.module, [])
      groups.get(perm.module).push(perm)
    }
    return groups
  }, [filteredPermissions])

  const isLoading = permsLoading || rolesLoading
  const isError = permsError || rolesError

  return (
    <>
      <div className="page-title-row">
        <div>
          <p className="eyebrow">PLATFORM ADMIN</p>
          <h1>Roles &amp; Permissions</h1>
          <p>Define what each role can access across every system module. Modify custom roles and apply capability presets.</p>
        </div>
        <div className="admin-row-actions">
          <button type="button" className="button button-ghost button-compact" onClick={() => setCreateModalOpen(true)}>
            <Plus size={14} /> New role
          </button>
          {hasDraftChanges && (
            <button type="button" className="button button-ghost button-compact" onClick={resetDraft} title="Discard unsaved edits">
              <RotateCcw size={14} /> Reset
            </button>
          )}
          <button
            type="button"
            className="button button-primary button-compact"
            onClick={save}
            disabled={!hasDraftChanges || saveMutation.isPending}
          >
            <Save size={14} /> {saveMutation.isPending ? 'Saving…' : hasDraftChanges ? 'Save changes *' : 'Saved'}
          </button>
        </div>
      </div>

      <div className="settings-card" style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <span className="notice-icon gold"><ShieldCheck size={18} /></span>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>Dynamic Capability Matrix</h2>
          <p style={{ margin: '4px 0 0', color: '#6d756d', fontSize: 12 }}>
            Manage access controls for core roles and custom dynamic roles. Changes take effect on user permissions immediately upon saving.
          </p>
        </div>

        {/* Preset Quick-Apply Toolbar */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#f5f7f4', padding: '8px 12px', border: '1px solid #e1e6e0' }}>
          <Sparkles size={14} style={{ color: 'var(--gold)' }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--forest)' }}>Apply Preset:</span>
          <select
            style={{ fontSize: 11, padding: '4px 8px', background: '#fff', border: '1px solid #d8ddd7' }}
            value={presetTargetRole}
            onChange={(e) => setPresetTargetRole(e.target.value)}
          >
            <option value="">Select target role…</option>
            {rolesList.map((r) => (
              <option key={r.role} value={r.role}>{r.label}</option>
            ))}
          </select>
          <select
            style={{ fontSize: 11, padding: '4px 8px', background: '#fff', border: '1px solid #d8ddd7' }}
            value={selectedPresetId}
            onChange={(e) => setSelectedPresetId(e.target.value)}
          >
            <option value="">Choose preset template…</option>
            {ROLE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            type="button"
            className="button button-ghost button-compact"
            disabled={!presetTargetRole || !selectedPresetId}
            onClick={() => {
              applyPreset(presetTargetRole, selectedPresetId)
              setSelectedPresetId('')
            }}
          >
            Apply
          </button>
        </div>
      </div>

      {notice && <p className="auth-notice" role="status" style={{ marginTop: 14 }}>{notice}</p>}
      {error && <p className="form-alert" role="alert" style={{ marginTop: 14 }}>{error}</p>}

      {/* Filter and Module Selection Bar */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginTop: 20, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 280 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#90988e' }} />
          <input
            type="text"
            placeholder="Search permissions or keys…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', paddingLeft: 32, fontSize: 12, height: 36, background: '#fff', border: '1px solid #d8ded7' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className={`button button-compact ${selectedModule === 'ALL' ? 'button-primary' : 'button-ghost'}`}
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => setSelectedModule('ALL')}
          >
            All Modules ({PERMISSION_CATALOG.length})
          </button>
          {PERMISSION_MODULES.map((mod) => (
            <button
              key={mod}
              type="button"
              className={`button button-compact ${selectedModule === mod ? 'button-primary' : 'button-ghost'}`}
              style={{ fontSize: 11, padding: '4px 8px' }}
              onClick={() => setSelectedModule(mod)}
            >
              {mod}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <Loading label="Loading roles and permissions matrix…" />
      ) : isError ? (
        <div className="operations-note" style={{ color: '#c0392b', display: 'flex', alignItems: 'center', gap: 10, padding: '24px 0' }}>
          <span>Failed to load roles: {permsErrObj?.message || rolesErrObj?.message || 'Server error.'}</span>
          <button type="button" className="button button-ghost button-compact" onClick={() => { refetchPerms(); refetchRoles() }}>
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      ) : (
        <div className="admin-matrix" style={{ marginTop: 16, overflowX: 'auto' }}>
          {/* Header Row */}
          <div
            className="admin-matrix-head"
            style={{
              display: 'grid',
              gridTemplateColumns: `minmax(280px, 2.2fr) repeat(${rolesList.length}, minmax(140px, 1fr))`,
              gap: 12,
              alignItems: 'center',
              minWidth: 280 + rolesList.length * 140,
            }}
          >
            <span>SYSTEM MODULE &amp; CAPABILITY</span>
            {rolesList.map((r) => {
              const rolePerms = matrix[r.role] ?? []
              const isCore = CORE_ROLES.has(r.role)
              return (
                <span key={r.role} style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                    <strong style={{ fontSize: 12, color: 'var(--forest)' }}>{r.label}</strong>
                    {!isCore && (
                      <button
                        type="button"
                        onClick={() => handleDeleteRole(r)}
                        title="Delete custom role"
                        style={{ border: 'none', background: 'transparent', color: '#c0392b', cursor: 'pointer', padding: 2 }}
                        aria-label={`Delete ${r.label}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                  <span style={{ fontSize: 9, color: isCore ? '#868e85' : '#b38228', fontWeight: 600 }}>
                    {isCore ? 'Core System' : 'Custom Role'}
                  </span>
                  <span style={{ fontSize: 9, color: '#9ba299' }}>
                    {rolePerms.length} / {PERMISSION_CATALOG.length} active
                  </span>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    <button
                      type="button"
                      className="button button-ghost button-compact"
                      style={{ padding: '2px 5px', fontSize: 9 }}
                      onClick={() => setRoleAll(r.role, true)}
                      title="Grant all permissions"
                    >
                      <CheckSquare size={10} /> All
                    </button>
                    <button
                      type="button"
                      className="button button-ghost button-compact"
                      style={{ padding: '2px 5px', fontSize: 9 }}
                      onClick={() => setRoleAll(r.role, false)}
                      title="Clear all permissions"
                    >
                      <Square size={10} /> None
                    </button>
                  </div>
                </span>
              )
            })}
          </div>

          {/* Module-Grouped Rows */}
          {Array.from(permissionsByModule.entries()).map(([moduleName, perms]) => (
            <div key={moduleName}>
              {/* Module Header Divider */}
              <div
                style={{
                  background: '#f2f4f0',
                  padding: '9px 18px',
                  fontWeight: 800,
                  fontSize: 11,
                  color: 'var(--forest)',
                  borderBottom: '1px solid #e2e6e0',
                  borderTop: '1px solid #e2e6e0',
                  letterSpacing: '.04em',
                  textTransform: 'uppercase',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>{moduleName} ({perms.length})</span>
              </div>

              {/* Capability Rows */}
              {perms.map((permission) => (
                <div
                  className="admin-matrix-row"
                  key={permission.key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `minmax(280px, 2.2fr) repeat(${rolesList.length}, minmax(140px, 1fr))`,
                    gap: 12,
                    alignItems: 'center',
                    minWidth: 280 + rolesList.length * 140,
                    padding: '10px 18px',
                  }}
                >
                  <span>
                    <strong>{permission.label}</strong>
                    <small style={{ color: '#888f86', fontSize: 9 }}>{permission.key}</small>
                  </span>
                  {rolesList.map((r) => {
                    const checked = (matrix[r.role] ?? []).includes(permission.key)
                    return (
                      <span key={r.role} style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          aria-label={`${r.label} — ${permission.label}`}
                          checked={checked}
                          onChange={() => toggle(r.role, permission.key)}
                          style={{ cursor: 'pointer', width: 16, height: 16 }}
                        />
                      </span>
                    )
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <CreateRoleModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={(newRoleSlug) => {
          setCreateModalOpen(false)
          toast.success(`Role "${newRoleSlug}" created. You can now configure its permissions below.`)
          queryClient.invalidateQueries({ queryKey: ['admin-roles'] })
          queryClient.invalidateQueries({ queryKey: ['admin-permissions'] })
        }}
      />
    </>
  )
}
