import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, FileText, FolderPlus, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import StatusPill from '../../../components/StatusPill.jsx'
import { createBuilderCategory, createBuilderHeader, createBuilderModule, deleteBuilderCategory, fetchBuilderCategories, fetchBuilderCourses, updateBuilderCategory, updateBuilderHeader, updateBuilderModule } from '../../../lib/lms.js'

const statusKind = { draft: 'gold', published: 'green', archived: 'red' }
const emptyCategory = { title: '', description: '', bannerPreset: 'forest' }

function ModuleForm({ header, position, onDone }) {
  const [type, setType] = useState('file')
  const [values, setValues] = useState({ title: '', instructions: '', resourceUrl: '', maxPoints: 100, passingScore: 70, feedbackTemplate: '', question: '', choices: ['', ''], answerIndex: 0 })
  const mutation = useMutation({ mutationFn: () => createBuilderModule(header._id, {
    type, title: values.title, instructions: values.instructions || undefined, resourceUrl: values.resourceUrl || undefined, position,
    quiz: type === 'quiz' ? { passingScore: Number(values.passingScore), questions: [{ prompt: values.question, choices: values.choices.filter(Boolean), answerIndex: Number(values.answerIndex) }] } : undefined,
    assignment: type === 'assignment' ? { maxPoints: Number(values.maxPoints), feedbackTemplate: values.feedbackTemplate || undefined } : undefined,
  }) })
  const submit = async (event) => { event.preventDefault(); await mutation.mutateAsync(); onDone() }
  return <form className="builder-module-form" onSubmit={submit}>
    <div className="builder-lesson-row"><label className="builder-field"><span>Module type</span><select value={type} onChange={(e) => setType(e.target.value)}><option value="file">File / link</option><option value="quiz">Quiz</option><option value="assignment">Assignment</option></select></label><label className="builder-field"><span>Title</span><input required value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} placeholder="Module title" /></label></div>
    <textarea value={values.instructions} onChange={(e) => setValues({ ...values, instructions: e.target.value })} placeholder="Instructions for learners" rows={2} />
    {type === 'file' && <input type="url" value={values.resourceUrl} onChange={(e) => setValues({ ...values, resourceUrl: e.target.value })} placeholder="File or resource URL (https://…)" />}
    {type === 'quiz' && <><input required value={values.question} onChange={(e) => setValues({ ...values, question: e.target.value })} placeholder="Question" /><div className="builder-lesson-row">{values.choices.map((choice, index) => <input required key={index} value={choice} onChange={(e) => setValues({ ...values, choices: values.choices.map((item, itemIndex) => itemIndex === index ? e.target.value : item) })} placeholder={`Choice ${index + 1}`} />)}</div><label className="builder-field"><span>Correct answer</span><select value={values.answerIndex} onChange={(e) => setValues({ ...values, answerIndex: e.target.value })}>{values.choices.map((_, index) => <option key={index} value={index}>Choice {index + 1}</option>)}</select></label><label className="builder-field"><span>Passing score (%)</span><input type="number" min="0" max="100" value={values.passingScore} onChange={(e) => setValues({ ...values, passingScore: e.target.value })} /></label></>}
    {type === 'assignment' && <><label className="builder-field"><span>Maximum points</span><input type="number" min="1" value={values.maxPoints} onChange={(e) => setValues({ ...values, maxPoints: e.target.value })} /></label><textarea value={values.feedbackTemplate} onChange={(e) => setValues({ ...values, feedbackTemplate: e.target.value })} placeholder="Feedback/comments template for future submissions" rows={2} /></>}
    <button className="button button-primary button-compact" disabled={mutation.isPending}><Plus size={14} /> Add module</button>
  </form>
}

function HeaderCard({ header, onDone }) {
  const [adding, setAdding] = useState(false)
  const mutation = useMutation({ mutationFn: (body) => updateBuilderHeader(header._id, body) })
  const publish = (module) => updateBuilderModule(module._id, { status: module.status === 'published' ? 'draft' : 'published' }).then(onDone)
  return <article className="builder-header-card"><div className="builder-module-head"><strong>{header.title}</strong><button className="button button-ghost button-compact" onClick={() => { const title = window.prompt('Header title', header.title); if (title?.trim()) mutation.mutate({ title: title.trim() }, { onSuccess: onDone }) }}>Edit header</button></div>
    {header.modules.map((module) => <div className="builder-content-module" key={module._id}><span><FileText size={14} /><strong>{module.title}</strong><small>{module.type}</small></span><span><StatusPill kind={statusKind[module.status]}>{module.status}</StatusPill><button className="button button-ghost button-compact" onClick={() => publish(module)}>{module.status === 'published' ? 'Unpublish' : 'Publish'}</button></span></div>)}
    {adding ? <ModuleForm header={header} position={header.modules.length} onDone={() => { setAdding(false); onDone() }} /> : <button className="builder-add-lesson" onClick={() => setAdding(true)}><Plus size={13} /> Add module</button>}
  </article>
}

function CategoryCard({ category, onDone }) {
  const [headerTitle, setHeaderTitle] = useState('')
  const [editingCard, setEditingCard] = useState(false)
  const createHeader = useMutation({ mutationFn: () => createBuilderHeader(category._id, { title: headerTitle, position: category.headers.length }) })
  const status = useMutation({ mutationFn: (next) => updateBuilderCategory(category._id, { status: next }) })
  const remove = useMutation({ mutationFn: () => deleteBuilderCategory(category._id) })
  return <article className="builder-category-card"><header style={{ background: category.bannerUrl ? `url(${category.bannerUrl}) center / cover` : category.bannerPreset === 'gold' ? '#af873c' : category.bannerPreset === 'ocean' ? '#31556e' : '#1b432e' }}><div><small>CATEGORY</small><h2>{category.title}</h2><p>{category.description || 'No description yet.'}</p></div><StatusPill kind={statusKind[category.status]}>{category.status}</StatusPill></header><div className="builder-category-body"><div className="builder-category-actions"><button className="button button-ghost button-compact" onClick={() => setEditingCard(true)}><Pencil size={13} /> Edit card</button><button className="button button-ghost button-compact" onClick={() => status.mutate(category.status === 'published' ? 'draft' : 'published', { onSuccess: onDone })}><Send size={13} /> {category.status === 'published' ? 'Unpublish' : 'Publish'}</button><button className="button button-ghost button-compact" onClick={() => status.mutate('archived', { onSuccess: onDone })}><Archive size={13} /> Archive</button><button className="button button-danger button-compact" onClick={() => remove.mutate(undefined, { onSuccess: onDone })}><Trash2 size={13} /> Delete</button></div>{category.headers.map((header) => <HeaderCard key={header._id} header={header} onDone={onDone} />)}<form className="builder-inline-form" onSubmit={async (e) => { e.preventDefault(); if (!headerTitle.trim()) return; await createHeader.mutateAsync(); setHeaderTitle(''); onDone() }}><input value={headerTitle} onChange={(e) => setHeaderTitle(e.target.value)} placeholder="New header" /><button className="button button-primary button-compact"><Plus size={13} /> Add header</button></form></div>
    {editingCard && <CategoryCustomizer initial={category} onClose={() => setEditingCard(false)} onCreated={onDone} />}
  </article>
}

export function CategoryCustomizer({ courseId, position, initial, onClose, onCreated }) {
  const isEdit = Boolean(initial)
  const [values, setValues] = useState(() => (initial
    ? { title: initial.title ?? '', description: initial.description ?? '', bannerPreset: initial.bannerPreset ?? 'forest', bannerUrl: initial.bannerUrl ?? '' }
    : emptyCategory))
  const mutation = useMutation({ mutationFn: () => (isEdit ? updateBuilderCategory(initial._id, values) : createBuilderCategory(courseId, { ...values, position })) })
  const cardPosition = isEdit ? (initial.position ?? 0) : position
  const background = values.bannerUrl ? `url(${values.bannerUrl}) center / cover` : values.bannerPreset === 'gold' ? '#b58b3d' : values.bannerPreset === 'ocean' ? '#31556e' : '#1b432e'
  return <div className="modal-backdrop"><form className="modal-panel category-customizer" onSubmit={async (event) => { event.preventDefault(); await mutation.mutateAsync(); onCreated(); onClose() }}><div className="image-crop-header"><h3>{isEdit ? 'Edit category card' : 'Customize category card'}</h3><button type="button" className="image-crop-close" onClick={onClose}>×</button></div><div className="category-card-preview" style={{ background }}><strong>{String(cardPosition + 1).padStart(2, '0')}</strong><div><small>PHASE {cardPosition + 1}</small><h2>{values.title || 'Category title'}</h2><p>{values.description || 'Your category description appears here.'}</p></div></div><label className="builder-field"><span>Title</span><input required value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} placeholder="Phase 1: Foundation" /></label><label className="builder-field"><span>Description</span><textarea value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} rows={3} /></label><div className="category-style-picks">{['forest', 'gold', 'ocean'].map((style) => <button type="button" className={`category-style ${style} ${values.bannerPreset === style && !values.bannerUrl ? 'active' : ''}`} key={style} onClick={() => setValues({ ...values, bannerPreset: style, bannerUrl: '' })}>{style}</button>)}</div><label className="builder-field"><span>Custom image URL (optional)</span><input type="url" value={values.bannerUrl ?? ''} onChange={(e) => setValues({ ...values, bannerUrl: e.target.value })} placeholder="https://…" /></label><div className="image-crop-actions"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button className="button" disabled={mutation.isPending}>{isEdit ? 'Save changes' : 'Create category'}</button></div></form></div>
}

export default function CategoryCourseBuilder({ role }) {
  const client = useQueryClient(); const [courseId, setCourseId] = useState(''); const [customizing, setCustomizing] = useState(false)
  const { data: courses = [] } = useQuery({ queryKey: ['builder-courses'], queryFn: fetchBuilderCourses, enabled: role !== 'learner' })
  const activeId = courseId || courses[0]?._id
  const { data: categories = [], isLoading } = useQuery({ queryKey: ['builder-categories', activeId], queryFn: () => fetchBuilderCategories(activeId), enabled: Boolean(activeId) })
  const refresh = () => client.invalidateQueries({ queryKey: ['builder-categories', activeId] })
  if (role === 'learner') return <p className="operations-note">This workspace is available to instructors and admins only.</p>
  return <><div className="page-title-row"><div><p className="eyebrow">TEACHING WORKSPACE</p><h1>Course catalog builder</h1><p>Select an assigned course, then build categories, headers, and learning modules.</p></div><label className="filter-button">Course <select value={activeId ?? ''} onChange={(e) => setCourseId(e.target.value)}>{courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}</select></label></div><section className="builder-wide-workspace">{!activeId ? <p className="operations-note">No course has been assigned to you yet.</p> : <><button type="button" className="button button-primary builder-add-category" onClick={() => setCustomizing(true)}><FolderPlus size={16} /> Add category</button>{customizing && <CategoryCustomizer courseId={activeId} position={categories.length} onClose={() => setCustomizing(false)} onCreated={refresh} />}{isLoading ? <p className="operations-note">Loading catalogue…</p> : categories.map((category) => <CategoryCard key={category._id} category={category} onDone={refresh} />)}{!isLoading && !categories.length && <p className="operations-note">Create the first category for this course.</p>}</>}</section></>
}
