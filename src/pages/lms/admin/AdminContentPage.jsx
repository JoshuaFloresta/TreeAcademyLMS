import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, FolderPlus, Trash2 } from 'lucide-react'
import { useConfirm } from '../../../lib/confirmContext.js'
import { useToast } from '../../../lib/toastContext.js'
import { createContentAsset, deleteContentAsset, fetchContentAssets } from '../../../lib/admin.js'

const categories = ['template', 'document', 'video', 'image', 'link', 'other']

export default function AdminContentPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [error, setError] = useState('')
  const [form, setForm] = useState({ title: '', category: 'template', url: '', description: '', tags: '' })
  const { data: assets = [], isLoading } = useQuery({ queryKey: ['admin-content'], queryFn: fetchContentAssets })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-content'] })
  const createMutation = useMutation({ mutationFn: createContentAsset })

  const submit = async (event) => {
    event.preventDefault(); setError('')
    try {
      await createMutation.mutateAsync({ ...form, tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean) })
      toast.success('Asset added.')
      setForm({ title: '', category: 'template', url: '', description: '', tags: '' })
      invalidate()
    } catch (e) { setError(e.message) }
  }
  const remove = async (asset) => {
    if (!(await confirm({ title: 'Remove this asset?', message: `“${asset.title}” will be removed from the shared library.`, confirmLabel: 'Remove asset' }))) return
    try { await deleteContentAsset(asset.id); toast.success('Asset removed.'); invalidate() } catch (e) { toast.error(e.message) }
  }

  return <>
    <div className="page-title-row"><div><p className="eyebrow">PLATFORM ADMIN</p><h1>Content Library</h1><p>Shared assets and templates available platform-wide.</p></div></div>

    <form className="admin-form admin-content-form" onSubmit={submit}>
      <span className="notice-icon gold"><FolderPlus size={18} /></span>
      <input required placeholder="Asset title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <input placeholder="Link / URL (optional)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
      <input placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <input placeholder="Tags, comma separated" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
      <button className="button button-primary button-compact" type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? 'Adding…' : 'Add asset'}</button>
    </form>

    {error && <p className="form-alert" role="alert">{error}</p>}

    {isLoading ? <p className="operations-note">Loading library…</p>
      : !assets.length ? <div className="empty-state"><FolderPlus size={26} /><strong>No shared assets yet</strong><p>Add templates, documents, or links for the whole platform to reuse.</p></div>
      : <div className="admin-card-grid">
        {assets.map((asset) => <article className="admin-asset-card" key={asset.id}>
          <div className="admin-asset-head"><span className="admin-chip">{asset.category}</span><button className="icon-button" onClick={() => remove(asset)} aria-label={`Delete ${asset.title}`}><Trash2 size={15} /></button></div>
          <h3>{asset.title}</h3>
          {asset.description && <p>{asset.description}</p>}
          {asset.tags?.length > 0 && <div className="admin-tag-row">{asset.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
          <div className="admin-asset-foot">
            {asset.url ? <a href={asset.url} target="_blank" rel="noreferrer" className="admin-asset-link"><ExternalLink size={14} /> Open</a> : <span />}
            <small>{asset.createdBy ?? 'Admin'}</small>
          </div>
        </article>)}
      </div>}
  </>
}
