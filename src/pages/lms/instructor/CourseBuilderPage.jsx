import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookOpen, Camera, Check, ChevronDown, ClipboardList, Eye, EyeOff, FileText, HelpCircle, Layers, Link as LinkIcon, Minus, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import StatusPill from '../../../components/StatusPill.jsx'
import CourseBanner from '../../../components/lms/CourseBanner.jsx'
import ImageCropModal from '../../../components/ImageCropModal.jsx'
import RichTextEditor from '../../../components/RichTextEditor.jsx'
import RichTextViewer from '../../../components/RichTextViewer.jsx'
import { bannerPresets } from '../../../lib/bannerPresets.js'
import { useConfirm } from '../../../lib/confirmContext.js'
import { useToast } from '../../../lib/toastContext.js'
import { createCourse, createLesson, createModule, deleteAssignment, deleteLesson, deleteModule, deleteQuiz, fetchCourse, fetchCourses, fetchQuizzes, submitCourseForReview, updateAssignment, updateCourse, updateLesson, updateModule, updateQuiz, uploadCourseBanner } from '../../../lib/lms.js'
import { dueLabel } from './builderShared.js'
import Loading from '../../../components/Loading.jsx'

const approvalLabel = { draft: { kind: 'gold', label: 'Needs approval' }, pending_review: { kind: 'gold', label: 'Awaiting admin review' }, approved: { kind: 'green', label: 'Approved' }, rejected: { kind: 'red', label: 'Changes requested' } }

const slugify = (value) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160)
const lessonKinds = ['article', 'video', 'document', 'link']
const kindLabel = { article: 'Article', video: 'Video lesson', document: 'Document', link: 'Resource link', header: 'Header' }

// Builds one ordered list out of a phase's lessons, module-level assignments (ones with no
// specific lesson attached), and module-scoped quizzes, so they can be arranged together in the
// Sections list instead of living in separate panels.
function phaseItems(module) {
  const items = [
    ...module.lessons.map((lesson) => ({ ...lesson, itemType: 'lesson' })),
    ...module.assignments.map((assignment) => ({ ...assignment, itemType: 'assignment' })),
    ...module.quizzes.map((quiz) => ({ ...quiz, itemType: 'quiz' })),
  ]
  return items.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
}

const updateItemPosition = { lesson: updateLesson, assignment: updateAssignment, quiz: updateQuiz }

// Reusable large panel for authoring flows that used to be squeezed inline into the narrow
// builder canvas (banner picker, assignment/quiz forms) — gives them a dedicated, roomy surface.
function BuilderModal({ title, onClose, children }) {
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal-panel builder-panel" onClick={(event) => event.stopPropagation()}>
      <div className="image-crop-header"><h3>{title}</h3><button type="button" className="image-crop-close" onClick={onClose} aria-label="Close">×</button></div>
      {children}
    </div>
  </div>
}

function AddModuleForm({ courseId, position, nextPhaseNumber, onDone }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [phaseNumber, setPhaseNumber] = useState(nextPhaseNumber)
  const [error, setError] = useState('')
  const toast = useToast()
  const mutation = useMutation({ mutationFn: () => createModule(courseId, { title: title.trim(), description: description.trim() || undefined, phaseNumber: Number(phaseNumber) || undefined, position }) })
  const submit = async (event) => {
    event.preventDefault()
    if (title.trim().length < 2) return
    setError('')
    try { await mutation.mutateAsync(); toast.success('Phase added.'); setTitle(''); setDescription(''); onDone() } catch (e) { setError(e.message) }
  }
  return <form className="builder-inline-form" onSubmit={submit}>
    <input type="number" min={1} max={99} value={phaseNumber} onChange={(event) => setPhaseNumber(event.target.value)} aria-label="Phase number" className="builder-phase-number" />
    <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Phase title (e.g. Foundations)" aria-label="New phase title" />
    <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Phase description (optional, shown on its catalog card)" aria-label="Phase description" />
    <button className="button button-primary button-compact" disabled={mutation.isPending}><Plus size={14} /> Add phase</button>
    {error && <span className="builder-error">{error}</span>}
  </form>
}

function EditModuleForm({ module, onCancel, onDone }) {
  const [values, setValues] = useState({ title: module.title, description: module.description ?? '', phaseNumber: module.phaseNumber ?? '' })
  const [error, setError] = useState('')
  const toast = useToast()
  const mutation = useMutation({ mutationFn: () => updateModule(module._id, { title: values.title.trim(), description: values.description.trim() || null, phaseNumber: values.phaseNumber ? Number(values.phaseNumber) : null }) })
  const submit = async (event) => {
    event.preventDefault()
    if (values.title.trim().length < 2) return
    setError('')
    try { await mutation.mutateAsync(); toast.success('Phase updated.'); onDone() } catch (e) { setError(e.message) }
  }
  return <form className="builder-inline-form" onSubmit={submit}>
    <input type="number" min={1} max={99} value={values.phaseNumber} onChange={(event) => setValues((prev) => ({ ...prev, phaseNumber: event.target.value }))} placeholder="#" aria-label="Phase number" className="builder-phase-number" />
    <input value={values.title} onChange={(event) => setValues((prev) => ({ ...prev, title: event.target.value }))} placeholder="Phase title" aria-label="Phase title" />
    <input value={values.description} onChange={(event) => setValues((prev) => ({ ...prev, description: event.target.value }))} placeholder="Phase description" aria-label="Phase description" />
    <button className="button button-primary button-compact" disabled={mutation.isPending}>Save</button>
    <button type="button" className="button button-ghost button-compact" onClick={onCancel}>Cancel</button>
    {error && <span className="builder-error">{error}</span>}
  </form>
}

function LessonForm({ moduleId, lesson, position, onCancel, onDone }) {
  const [values, setValues] = useState({ title: lesson?.title ?? '', kind: lesson?.kind ?? 'article', body: lesson?.body ?? '', driveUrl: lesson?.driveUrl ?? '' })
  const [error, setError] = useState('')
  const toast = useToast()
  const payload = () => ({ title: values.title.trim(), kind: values.kind, body: values.body.trim() || undefined, driveUrl: values.driveUrl.trim() || null, position })
  const mutation = useMutation({ mutationFn: () => (lesson ? updateLesson(lesson._id, payload()) : createLesson(moduleId, payload())) })
  const submit = async (event) => {
    event.preventDefault()
    if (values.title.trim().length < 2) return
    if (values.driveUrl.trim() && !/^https?:\/\//.test(values.driveUrl.trim())) { setError('The resource link must start with http:// or https://'); return }
    setError('')
    try { await mutation.mutateAsync(); toast.success(lesson ? 'Lesson updated.' : 'Lesson added.'); onDone() } catch (e) { setError(e.message) }
  }
  return <form className="builder-lesson-form" onSubmit={submit}>
    <div className="builder-lesson-row">
      <input value={values.title} onChange={(event) => setValues((prev) => ({ ...prev, title: event.target.value }))} placeholder="Lesson title" aria-label="Lesson title" />
      <select value={values.kind} onChange={(event) => setValues((prev) => ({ ...prev, kind: event.target.value }))} aria-label="Lesson type">{lessonKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select>
    </div>
    <RichTextEditor value={values.body} onChange={(html) => setValues((prev) => ({ ...prev, body: html }))} placeholder="Lesson content (optional)" ariaLabel="Lesson content" />
    <input value={values.driveUrl} onChange={(event) => setValues((prev) => ({ ...prev, driveUrl: event.target.value }))} placeholder="Google Drive PDF link (optional) — https://drive.google.com/…" aria-label="Resource link" />
    <div className="builder-lesson-actions"><button className="button button-primary button-compact" disabled={mutation.isPending}>{lesson ? 'Save changes' : 'Save lesson'}</button><button type="button" className="button button-ghost button-compact" onClick={onCancel}>Cancel</button></div>
    {error && <span className="builder-error">{error}</span>}
  </form>
}

function HeaderForm({ moduleId, lesson, position, onCancel, onDone }) {
  const [title, setTitle] = useState(lesson?.title ?? '')
  const [error, setError] = useState('')
  const toast = useToast()
  const mutation = useMutation({ mutationFn: () => (lesson ? updateLesson(lesson._id, { title: title.trim() }) : createLesson(moduleId, { title: title.trim(), kind: 'header', position })) })
  const submit = async (event) => {
    event.preventDefault()
    if (title.trim().length < 2) return
    setError('')
    try { await mutation.mutateAsync(); toast.success(lesson ? 'Header updated.' : 'Header added.'); onDone() } catch (e) { setError(e.message) }
  }
  return <form className="builder-inline-form" onSubmit={submit}>
    <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Header text (e.g. Practice exercises)" aria-label="Header text" autoFocus />
    <button className="button button-primary button-compact" disabled={mutation.isPending}>{lesson ? 'Save changes' : 'Add header'}</button>
    <button type="button" className="button button-ghost button-compact" onClick={onCancel}>Cancel</button>
    {error && <span className="builder-error">{error}</span>}
  </form>
}

// Lets an instructor add any kind of section — a lesson, a module-level assignment/quiz (which
// open their full-page editors, prefilled to this phase), or a plain header/separator — directly
// from the phase's own Sections list instead of a panel elsewhere on the page.
function AddSectionControls({ course, module, position, onDone }) {
  const navigate = useNavigate()
  const [mode, setMode] = useState('')
  if (mode === 'lesson') return <LessonForm moduleId={module._id} position={position} onCancel={() => setMode('')} onDone={() => { setMode(''); onDone() }} />
  if (mode === 'header') return <HeaderForm moduleId={module._id} position={position} onCancel={() => setMode('')} onDone={() => { setMode(''); onDone() }} />
  return <div className="builder-add-section-row">
    <button type="button" className="builder-add-lesson" onClick={() => setMode('lesson')}><Plus size={13} /> Add lesson</button>
    <button type="button" className="builder-add-lesson" onClick={() => navigate(`/builder/assignments/new?course=${course._id}&module=${module._id}&position=${position}`)}><ClipboardList size={13} /> Add assignment</button>
    <button type="button" className="builder-add-lesson" onClick={() => navigate(`/builder/quizzes/new?course=${course._id}&module=${module._id}&position=${position}`)}><HelpCircle size={13} /> Add quiz</button>
    <button type="button" className="builder-add-lesson" onClick={() => setMode('header')}><Minus size={13} /> Add header</button>
  </div>
}

// Mirrors the learner catalog's collapsible lesson row (CatalogPage.jsx's LessonSection), with
// instructor-only reorder/edit/publish/delete controls in the head instead of a plain view.
function BuilderLessonSection({ lesson, onEdit, onDelete, onTogglePublish, onMoveUp, onMoveDown, canMoveUp, canMoveDown }) {
  const [open, setOpen] = useState(false)
  if (lesson.kind === 'header') return <li className="module-header-row">
    <span><Minus size={13} /> {lesson.title}</span>
    <div className="lesson-section-actions">
      <button type="button" onClick={onMoveUp} disabled={!canMoveUp} aria-label="Move header up"><ArrowUp size={12} /></button>
      <button type="button" onClick={onMoveDown} disabled={!canMoveDown} aria-label="Move header down"><ArrowDown size={12} /></button>
      <button type="button" onClick={onEdit} aria-label="Edit header"><Pencil size={12} /></button>
      <button type="button" className="builder-danger" onClick={onDelete} aria-label="Delete header"><Trash2 size={12} /></button>
    </div>
  </li>
  return <li className="module-lesson-item">
    <div className="lesson-section-head">
      <button type="button" className="lesson-section-toggle" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <ChevronDown size={14} className={`lesson-section-chevron ${open ? 'open' : ''}`} />
        <FileText size={13} /> {lesson.title}
        <small style={{ marginLeft: 8, opacity: .6 }}>{kindLabel[lesson.kind] ?? lesson.kind}</small>
      </button>
      <div className="lesson-section-actions">
        <button type="button" onClick={onMoveUp} disabled={!canMoveUp} aria-label="Move lesson up"><ArrowUp size={12} /></button>
        <button type="button" onClick={onMoveDown} disabled={!canMoveDown} aria-label="Move lesson down"><ArrowDown size={12} /></button>
        <button type="button" onClick={onEdit} aria-label="Edit lesson"><Pencil size={12} /></button>
        <button type="button" onClick={onTogglePublish} aria-label={lesson.isPublished ? 'Unpublish lesson' : 'Publish lesson'}>{lesson.isPublished ? <Eye size={12} /> : <EyeOff size={12} />}</button>
        <button type="button" className="builder-danger" onClick={onDelete} aria-label="Delete lesson"><Trash2 size={12} /></button>
      </div>
    </div>
    {open && <div className="lesson-section-body">
      {lesson.body && <RichTextViewer html={lesson.body} className="assignment-block-instructions" />}
      {lesson.driveUrl
        ? <a href={lesson.driveUrl} target="_blank" rel="noreferrer" className="lesson-resource-link"><LinkIcon size={12} /> Open PDF in new tab</a>
        : !lesson.body && <p className="operations-note">No content added to this lesson yet.</p>}
      <div style={{ marginTop: 10 }}><StatusPill kind={lesson.isPublished ? 'green' : 'gold'}>{lesson.isPublished ? 'Published' : 'Draft'}</StatusPill></div>
    </div>}
  </li>
}

// Assignment/quiz rows in the Sections list — editing still opens the full-page editor (rich
// instructions/questions need the room), but creating, ordering, and deleting now happen inline.
function BuilderAssignmentRow({ assignment, onDelete, onMoveUp, onMoveDown, canMoveUp, canMoveDown }) {
  const navigate = useNavigate()
  return <li className="module-lesson-item">
    <div className="lesson-section-head">
      <span className="lesson-section-toggle" style={{ cursor: 'default' }}>
        <ClipboardList size={13} /> {assignment.title}
        <small style={{ marginLeft: 8, opacity: .6 }}>Assignment · {dueLabel(assignment.dueAt)} · {assignment.maxPoints} pts</small>
      </span>
      <div className="lesson-section-actions">
        <button type="button" onClick={onMoveUp} disabled={!canMoveUp} aria-label="Move assignment up"><ArrowUp size={12} /></button>
        <button type="button" onClick={onMoveDown} disabled={!canMoveDown} aria-label="Move assignment down"><ArrowDown size={12} /></button>
        <button type="button" onClick={() => navigate(`/builder/assignments/${assignment._id}`)} aria-label="Edit assignment"><Pencil size={12} /></button>
        <button type="button" className="builder-danger" onClick={onDelete} aria-label="Delete assignment"><Trash2 size={12} /></button>
      </div>
    </div>
  </li>
}

function BuilderQuizRow({ quiz, onDelete, onTogglePublish, onMoveUp, onMoveDown, canMoveUp, canMoveDown }) {
  const navigate = useNavigate()
  return <li className="module-lesson-item">
    <div className="lesson-section-head">
      <span className="lesson-section-toggle" style={{ cursor: 'default' }}>
        <HelpCircle size={13} /> {quiz.title}
        <small style={{ marginLeft: 8, opacity: .6 }}>Quiz · {quiz.questionCount} question{quiz.questionCount === 1 ? '' : 's'}</small>
      </span>
      <div className="lesson-section-actions">
        <button type="button" onClick={onMoveUp} disabled={!canMoveUp} aria-label="Move quiz up"><ArrowUp size={12} /></button>
        <button type="button" onClick={onMoveDown} disabled={!canMoveDown} aria-label="Move quiz down"><ArrowDown size={12} /></button>
        <button type="button" onClick={() => navigate(`/builder/quizzes/${quiz._id}`)} aria-label="Edit quiz"><Pencil size={12} /></button>
        <button type="button" onClick={onTogglePublish} aria-label={quiz.isPublished ? 'Unpublish quiz' : 'Publish quiz'}>{quiz.isPublished ? <Eye size={12} /> : <EyeOff size={12} />}</button>
        <button type="button" className="builder-danger" onClick={onDelete} aria-label="Delete quiz"><Trash2 size={12} /></button>
      </div>
    </div>
  </li>
}

// Quizzes created before phases could own one (moduleId unset) would otherwise vanish from the
// builder now that quizzes render inside their phase's Sections list — this keeps them visible
// and editable (the quiz editor's phase picker lets an instructor file them under a phase).
function UnassignedQuizzesSection({ course, onDone }) {
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const { data: all = [] } = useQuery({ queryKey: ['quizzes'], queryFn: fetchQuizzes })
  const quizzes = all.filter((quiz) => String(quiz.courseId) === String(course._id) && !quiz.moduleId)
  const deleteMutation = useMutation({ mutationFn: (id) => deleteQuiz(id) })
  const removeQuiz = async (quiz) => {
    if (!(await confirm({ title: 'Delete this quiz?', message: `“${quiz.title}” and every learner attempt will be permanently deleted.`, confirmLabel: 'Delete quiz' }))) return
    try { await deleteMutation.mutateAsync(quiz._id); toast.success('Quiz deleted.'); onDone() } catch (e) { toast.error(e.message) }
  }
  if (!quizzes.length) return null
  return <>
    <div className="builder-section-label"><HelpCircle size={15} /> Quizzes not yet filed under a phase</div>
    <div className="builder-item-list">
      {quizzes.map((quiz) => <div className="builder-item" key={quiz._id}>
        <span><strong>{quiz.title}</strong><small>{quiz.questionCount} question{quiz.questionCount === 1 ? '' : 's'}</small></span>
        <span className="builder-item-actions">
          <button type="button" onClick={() => navigate(`/builder/quizzes/${quiz._id}`)} aria-label="Edit quiz"><Pencil size={14} /></button>
          <button type="button" className="builder-danger" onClick={() => removeQuiz(quiz)} aria-label="Delete quiz"><Trash2 size={14} /></button>
        </span>
      </div>)}
    </div>
  </>
}

function BannerPicker({ course, onDone }) {
  const toast = useToast()
  const fileRef = useRef(null)
  const [error, setError] = useState('')
  const [pendingFile, setPendingFile] = useState(null)
  const presetMutation = useMutation({ mutationFn: (bannerPreset) => updateCourse(course._id, { bannerPreset }) })
  const uploadMutation = useMutation({ mutationFn: (file) => uploadCourseBanner(course._id, file) })
  const pickPreset = async (key) => {
    setError('')
    try { await presetMutation.mutateAsync(key); toast.success('Banner updated.'); onDone() } catch (e) { setError(e.message); toast.error(e.message) }
  }
  const pickFile = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    setPendingFile(file)
  }
  const confirmCrop = (cropped) => {
    setPendingFile(null)
    uploadMutation.mutate(cropped, {
      onSuccess: () => { toast.success('Banner uploaded.'); onDone() },
      onError: (e) => { setError(e.message); toast.error(e.message) },
    })
  }
  return <div className="builder-banner-picker">
    <div className="builder-banner-current"><CourseBanner course={course} /></div>
    <p className="builder-banner-hint">Choose a ready-made style, or upload your own image (JPG/PNG/WEBP, under 4MB).</p>
    <div className="builder-banner-presets">
      {bannerPresets.map((preset) => {
        const Icon = preset.icon
        const active = !course.bannerUrl && (course.bannerPreset ?? 'forest') === preset.key
        return <button type="button" key={preset.key} className={`builder-banner-swatch ${active ? 'active' : ''}`} style={{ background: preset.gradient }} onClick={() => pickPreset(preset.key)} aria-label={`Use ${preset.label} banner`} disabled={presetMutation.isPending}>
          {active ? <Check size={16} /> : <Icon size={16} />}
        </button>
      })}
    </div>
    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={pickFile} hidden />
    <button type="button" className="button button-ghost button-compact" onClick={() => fileRef.current?.click()} disabled={uploadMutation.isPending}>{uploadMutation.isPending ? 'Uploading…' : 'Upload custom image'}</button>
    {error && <span className="builder-error">{error}</span>}
    {pendingFile && <ImageCropModal
      file={pendingFile}
      aspect={16 / 9}
      shape="rect"
      outputWidth={960}
      onCancel={() => setPendingFile(null)}
      onConfirm={confirmCrop}
    />}
  </div>
}

function NewCourseForm({ onCreated }) {
  const [values, setValues] = useState({ title: '', slug: '', description: '' })
  const [touchedSlug, setTouchedSlug] = useState(false)
  const [error, setError] = useState('')
  const toast = useToast()
  const mutation = useMutation({ mutationFn: () => createCourse({ title: values.title.trim(), slug: values.slug.trim(), description: values.description.trim() || undefined }) })
  const submit = async (event) => {
    event.preventDefault()
    setError('')
    try { const course = await mutation.mutateAsync(); toast.success('Course created.'); setValues({ title: '', slug: '', description: '' }); setTouchedSlug(false); onCreated(course) } catch (e) { setError(e.message) }
  }
  return <form className="builder-new-course" onSubmit={submit}>
    <p className="eyebrow">NEW COURSE</p>
    <input value={values.title} onChange={(event) => { const title = event.target.value; setValues((prev) => ({ ...prev, title, slug: touchedSlug ? prev.slug : slugify(title) })) }} placeholder="Course title" aria-label="Course title" />
    <input value={values.slug} onChange={(event) => { setTouchedSlug(true); setValues((prev) => ({ ...prev, slug: slugify(event.target.value) })) }} placeholder="course-slug" aria-label="Course slug" />
    <textarea value={values.description} onChange={(event) => setValues((prev) => ({ ...prev, description: event.target.value }))} placeholder="Short description (optional)" rows={2} />
    <button className="button button-primary button-compact full" disabled={mutation.isPending}><Plus size={14} /> Create course</button>
    {error && <span className="builder-error">{error}</span>}
  </form>
}

// Full-width phase editor — rendered outside the sidebar/canvas grid entirely so it gets the
// whole page to work with instead of fighting the course-switcher sidebar for space.
function PhaseDetailEditor({ course, module, index, editingModuleId, setEditingModuleId, editingLessonId, setEditingLessonId, togglePhasePublish, toggleLessonPublish, toggleQuizPublish, reorderItem, removeLesson, removeAssignment, removeQuiz, refreshCourse, onBack }) {
  const items = phaseItems(module)
  return <>
    <div className="page-title-row builder-editor-page-title">
      <div><p className="eyebrow">TEACHING WORKSPACE</p><h1>{course.title}</h1><p>Editing phase {module.phaseNumber ?? index + 1}.</p></div>
    </div>
    <button type="button" className="filter-button builder-back-button" onClick={onBack}><ArrowLeft size={15} /> All phases</button>
    <div className="course-details builder-phase-editor">
      <div className="course-details-header">
        {editingModuleId === module._id
          ? <div style={{ flex: 1 }}><EditModuleForm module={module} onCancel={() => setEditingModuleId('')} onDone={() => { setEditingModuleId(''); refreshCourse() }} /></div>
          : <div>
            <p className="eyebrow">{course.title} · PHASE {module.phaseNumber ?? index + 1}</p>
            <h2>{module.title}<button type="button" className="phase-edit-trigger" onClick={() => setEditingModuleId(module._id)} aria-label="Edit phase"><Pencil size={15} /></button></h2>
            <p>{module.description || 'No phase description yet.'}</p>
          </div>}
        <div className="course-details-facts builder-phase-facts">
          <span><Layers size={14} /><b>{items.length}</b> {items.length === 1 ? 'section' : 'sections'}</span>
          <span className={module.isPublished ? 'is-live' : 'is-draft'}>{module.isPublished ? <Eye size={14} /> : <EyeOff size={14} />} {module.isPublished ? 'Live to learners' : 'Not published'}</span>
        </div>
      </div>
      <div className="course-details-content single-column">
        <div className="course-syllabus">
          <div className="course-section-heading builder-sections-heading">
            <div><p className="eyebrow">PHASE CONTENT</p><h2>Sections</h2><small>Arrange the learner experience and open a section to preview its content.</small></div>
            <button type="button" className={`button button-compact ${module.isPublished ? 'button-ghost' : 'button-primary'}`} onClick={() => togglePhasePublish(module)}>{module.isPublished ? <><EyeOff size={14} /> Unpublish phase</> : <><Eye size={14} /> Publish phase</>}</button>
          </div>
          {!items.length && <p className="operations-note">Nothing here yet — add the first section below.</p>}
          <ul className="module-lesson-list">
            {items.map((item, itemIndex) => {
              const canMoveUp = itemIndex > 0
              const canMoveDown = itemIndex < items.length - 1
              const onMoveUp = () => reorderItem(module, item, -1)
              const onMoveDown = () => reorderItem(module, item, 1)
              if (item.itemType === 'assignment') return <BuilderAssignmentRow key={`assignment-${item._id}`} assignment={item} canMoveUp={canMoveUp} canMoveDown={canMoveDown} onMoveUp={onMoveUp} onMoveDown={onMoveDown} onDelete={() => removeAssignment(item)} />
              if (item.itemType === 'quiz') return <BuilderQuizRow key={`quiz-${item._id}`} quiz={item} canMoveUp={canMoveUp} canMoveDown={canMoveDown} onMoveUp={onMoveUp} onMoveDown={onMoveDown} onDelete={() => removeQuiz(item)} onTogglePublish={() => toggleQuizPublish(item)} />
              if (editingLessonId === item._id && item.kind === 'header') return <li key={`lesson-${item._id}`}><HeaderForm moduleId={module._id} lesson={item} position={item.position} onCancel={() => setEditingLessonId('')} onDone={() => { setEditingLessonId(''); refreshCourse() }} /></li>
              return editingLessonId === item._id
                ? <li key={`lesson-${item._id}`}><LessonForm moduleId={module._id} lesson={item} position={item.position} onCancel={() => setEditingLessonId('')} onDone={() => { setEditingLessonId(''); refreshCourse() }} /></li>
                : <BuilderLessonSection
                    key={`lesson-${item._id}`}
                    lesson={item}
                    canMoveUp={canMoveUp}
                    canMoveDown={canMoveDown}
                    onMoveUp={onMoveUp}
                    onMoveDown={onMoveDown}
                    onEdit={() => setEditingLessonId(item._id)}
                    onDelete={() => removeLesson(module, item)}
                    onTogglePublish={() => toggleLessonPublish(item)}
                  />
            })}
          </ul>
          <AddSectionControls course={course} module={module} position={items.length} onDone={refreshCourse} />
        </div>
      </div>
    </div>
  </>
}

export default function CourseBuilderPage({ role }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [selectedId, setSelectedId] = useState('')
  const [editingModuleId, setEditingModuleId] = useState('')
  const [editingLessonId, setEditingLessonId] = useState('')
  const [openModuleId, setOpenModuleId] = useState('')
  const [bannerOpen, setBannerOpen] = useState(false)
  const { data: courseResults, isError: coursesFailed, error: coursesError } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses, enabled: role !== 'learner' })
  const courses = Array.isArray(courseResults) ? courseResults.filter(Boolean) : []
  const activeId = selectedId || courses[0]?._id || ''
  const { data: loadedCourse, isLoading, isError: courseFailed, error: courseError } = useQuery({ queryKey: ['builder-course', activeId], queryFn: () => fetchCourse(activeId), enabled: Boolean(activeId) })
  // Older/imported courses can have no modules yet. Normalising here keeps the
  // builder usable while the instructor adds its first phase.
  const course = loadedCourse ? {
    ...loadedCourse,
    modules: (Array.isArray(loadedCourse.modules) ? loadedCourse.modules : [])
      .filter(Boolean)
      .map((module) => ({
        ...module,
        lessons: Array.isArray(module.lessons) ? module.lessons.filter(Boolean) : [],
        assignments: Array.isArray(module.assignments) ? module.assignments.filter(Boolean) : [],
        quizzes: Array.isArray(module.quizzes) ? module.quizzes.filter(Boolean) : [],
      })),
  } : null

  const refreshCourse = () => {
    for (const key of [['builder-course', activeId], ['courses'], ['assignments'], ['quizzes'], ['staff-overview']]) queryClient.invalidateQueries({ queryKey: key })
  }
  const toggle = async (mutationFn, message) => { try { await mutationFn(); if (message) toast.success(message); refreshCourse() } catch (e) { toast.error(e.message) } }
  const unpublishCourse = async () => {
    if (!course?._id) return
    if (!(await confirm({ message: `“${course.title}” will disappear from learners immediately.`, confirmLabel: 'Unpublish' }))) return
    toggle(() => updateCourse(course._id, { isPublished: false }), 'Course unpublished.')
  }
  const publishCourse = async () => {
    if (!course?._id) return
    if (!(await confirm({ title: 'Publish this course?', message: `“${course.title}” becomes visible to every enrolled learner immediately.`, confirmLabel: 'Publish', danger: false }))) return
    toggle(() => updateCourse(course._id, { isPublished: true }), 'Course published.')
  }
  const togglePhasePublish = async (module) => {
    if (!module.isPublished && !(await confirm({ title: 'Publish this phase?', message: `“${module.title}” becomes visible to every enrolled learner immediately.`, confirmLabel: 'Publish', danger: false }))) return
    toggle(() => updateModule(module._id, { isPublished: !module.isPublished }), module.isPublished ? 'Phase unpublished.' : 'Phase published.')
  }
  const toggleLessonPublish = async (lesson) => {
    if (!lesson.isPublished && !(await confirm({ title: 'Publish this lesson?', message: `“${lesson.title}” becomes visible to every enrolled learner immediately.`, confirmLabel: 'Publish', danger: false }))) return
    toggle(() => updateLesson(lesson._id, { isPublished: !lesson.isPublished }), lesson.isPublished ? 'Lesson unpublished.' : 'Lesson published.')
  }
  const reorderModule = (module, direction) => {
    const list = course.modules
    const index = list.findIndex((item) => item._id === module._id)
    const target = index + direction
    if (target < 0 || target >= list.length) return
    toggle(() => Promise.all([updateModule(module._id, { position: target }), updateModule(list[target]._id, { position: index })]))
  }
  // Lessons, module-level assignments, and quizzes are rendered as one ordered "Sections" list per
  // phase (see phaseItems above) — reordering swaps `position` across whichever two collections
  // the moved item and its neighbor happen to belong to.
  const reorderItem = (module, item, direction) => {
    const list = phaseItems(module)
    const index = list.findIndex((entry) => entry.itemType === item.itemType && entry._id === item._id)
    const target = index + direction
    if (target < 0 || target >= list.length) return
    const other = list[target]
    toggle(() => Promise.all([
      updateItemPosition[item.itemType](item._id, { position: target }),
      updateItemPosition[other.itemType](other._id, { position: index }),
    ]))
  }
  const removeModule = async (module) => {
    if (!(await confirm({ title: 'Delete this phase?', message: `“${module.title}” and its ${module.lessons.length} lesson${module.lessons.length === 1 ? '' : 's'} (plus any assignments tied to it) will be permanently deleted.`, confirmLabel: 'Delete phase' }))) return
    try { await deleteModule(module._id); toast.success('Phase deleted.'); if (openModuleId === module._id) setOpenModuleId(''); refreshCourse() } catch (e) { toast.error(e.message) }
  }
  const removeLesson = async (module, lesson) => {
    const noun = lesson.kind === 'header' ? 'header' : 'lesson'
    if (!(await confirm({ title: `Delete this ${noun}?`, message: `“${lesson.title}” will be permanently deleted.`, confirmLabel: `Delete ${noun}` }))) return
    try { await deleteLesson(lesson._id); toast.success(`${noun === 'header' ? 'Header' : 'Lesson'} deleted.`); refreshCourse() } catch (e) { toast.error(e.message) }
  }
  const removeAssignment = async (assignment) => {
    if (!(await confirm({ title: 'Delete this assignment?', message: `“${assignment.title}” and all its submissions will be permanently deleted.`, confirmLabel: 'Delete assignment' }))) return
    try { await deleteAssignment(assignment._id); toast.success('Assignment deleted.'); refreshCourse() } catch (e) { toast.error(e.message) }
  }
  const removeQuiz = async (quiz) => {
    if (!(await confirm({ title: 'Delete this quiz?', message: `“${quiz.title}” and every learner attempt will be permanently deleted.`, confirmLabel: 'Delete quiz' }))) return
    try { await deleteQuiz(quiz._id); toast.success('Quiz deleted.'); refreshCourse() } catch (e) { toast.error(e.message) }
  }
  const toggleQuizPublish = async (quiz) => {
    if (!quiz.isPublished && !(await confirm({ title: 'Publish this quiz?', message: `“${quiz.title}” becomes visible and attemptable by every learner in this course.`, confirmLabel: 'Publish', danger: false }))) return
    toggle(() => updateQuiz(quiz._id, { isPublished: !quiz.isPublished }), quiz.isPublished ? 'Quiz unpublished.' : 'Quiz published.')
  }

  if (role === 'learner') return <p className="operations-note">This workspace is available to instructors and admins only.</p>

  const openIndex = course ? course.modules.findIndex((item) => item._id === openModuleId) : -1
  const openModule = openIndex >= 0 ? course.modules[openIndex] : null

  // A phase is open for editing — break out of the sidebar/canvas grid entirely so the editor
  // gets the full page width instead of being squeezed next to the course switcher.
  if (course && openModule) return <PhaseDetailEditor
    course={course}
    module={openModule}
    index={openIndex}
    editingModuleId={editingModuleId}
    setEditingModuleId={setEditingModuleId}
    editingLessonId={editingLessonId}
    setEditingLessonId={setEditingLessonId}
    togglePhasePublish={togglePhasePublish}
    toggleLessonPublish={toggleLessonPublish}
    toggleQuizPublish={toggleQuizPublish}
    reorderItem={reorderItem}
    removeLesson={removeLesson}
    removeAssignment={removeAssignment}
    removeQuiz={removeQuiz}
    refreshCourse={refreshCourse}
    onBack={() => setOpenModuleId('')}
  />

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">TEACHING WORKSPACE</p><h1>Course builder</h1><p>Author courses, organise modules and lessons, and set assignments.</p></div>
    </div>
    <div className="builder-layout">
      <aside className="builder-sidebar">
        <div className="builder-course-list">
          {coursesFailed && <p className="form-alert" role="alert">{coursesError?.message ?? 'Could not load courses. Please refresh and try again.'}</p>}
          {courses.map((item) => <button type="button" key={item._id} className={`builder-course-item ${item._id === activeId ? 'active' : ''}`} onClick={() => setSelectedId(item._id)}>
            <span><BookOpen size={15} /> {item.title}</span>
            <StatusPill kind={item.isPublished ? 'green' : 'gold'}>{item.isPublished ? 'Live' : 'Draft'}</StatusPill>
          </button>)}
          {!courses.length && <p className="operations-note">No courses yet — create your first below.</p>}
        </div>
        <NewCourseForm onCreated={(created) => { const createdId = created?._id ?? created?.id; if (createdId) setSelectedId(createdId); refreshCourse() }} />
      </aside>
      <section className="builder-canvas">
        {!activeId ? <p className="operations-note">Select or create a course to begin.</p>
          : isLoading ? <Loading label="Loading course…" />
          : courseFailed ? <p className="form-alert" role="alert">{courseError?.message ?? 'Could not load this course. Please choose another course or refresh the page.'}</p>
          : !course ? <p className="operations-note">Course details are unavailable. Please choose another course or refresh the page.</p>
          : <>
            <div className="builder-course-head">
              <div><h2>{course.title}</h2><small>/{course.slug} · {course.modules.length} module{course.modules.length === 1 ? '' : 's'}</small></div>
              <div className="builder-course-controls">
                {role !== 'admin' && approvalLabel[course.approvalStatus ?? 'draft'] && <StatusPill kind={approvalLabel[course.approvalStatus ?? 'draft'].kind}>{approvalLabel[course.approvalStatus ?? 'draft'].label}</StatusPill>}
                {role !== 'admin' && ['draft', 'rejected'].includes(course.approvalStatus ?? 'draft') && <button className="button button-ghost button-compact" onClick={() => toggle(() => submitCourseForReview(course._id), 'Submitted for admin approval.')}><Send size={14} /> Submit for approval</button>}
                <button className="button button-ghost button-compact" onClick={() => setBannerOpen(true)}><Camera size={14} /> Card banner</button>
                <button className="button button-ghost button-compact" onClick={() => (course.isPublished ? unpublishCourse() : publishCourse())}>{course.isPublished ? <><EyeOff size={14} /> Unpublish</> : <><Eye size={14} /> Publish</>}</button>
              </div>
            </div>
            {course.approvalStatus === 'rejected' && course.reviewNote && <p className="form-alert" role="alert">Admin feedback: {course.reviewNote}</p>}
            {bannerOpen && <BuilderModal title="Card banner" onClose={() => setBannerOpen(false)}><BannerPicker course={course} onDone={refreshCourse} /></BuilderModal>}

            <div className="builder-section-label"><Layers size={15} /> Phases & lessons</div>
            <div className="catalog-grid">
              {course.modules.map((module, moduleIndex) => editingModuleId === module._id
                ? <div className="catalog-card" key={module._id} style={{ padding: 18 }}><EditModuleForm module={module} onCancel={() => setEditingModuleId('')} onDone={() => { setEditingModuleId(''); refreshCourse() }} /></div>
                : <article className="catalog-card" key={module._id}>
                  <CourseBanner course={course} index={moduleIndex}><span>{String(module.phaseNumber ?? moduleIndex + 1).padStart(2, '0')}</span></CourseBanner>
                  <div>
                    <p className="eyebrow">PHASE {module.phaseNumber ?? moduleIndex + 1}</p>
                    <h2>{module.title}</h2>
                    <p>{module.description || 'Phase description coming soon.'}</p>
                    <div className="catalog-foot">
                      <div className="catalog-foot-actions">
                        <StatusPill kind={module.isPublished ? 'green' : 'gold'}>{module.isPublished ? 'Published' : 'Draft'}</StatusPill>
                        <button type="button" onClick={() => reorderModule(module, -1)} disabled={moduleIndex === 0} aria-label="Move phase up"><ArrowUp size={13} /></button>
                        <button type="button" onClick={() => reorderModule(module, 1)} disabled={moduleIndex === course.modules.length - 1} aria-label="Move phase down"><ArrowDown size={13} /></button>
                        <button type="button" onClick={() => setEditingModuleId(module._id)} aria-label="Edit phase"><Pencil size={13} /></button>
                        <button type="button" className="builder-danger" onClick={() => removeModule(module)} aria-label="Delete phase"><Trash2 size={13} /></button>
                      </div>
                      <button type="button" onClick={() => setOpenModuleId(module._id)} aria-label={`Manage ${module.title}`}><ArrowRight size={18} /></button>
                    </div>
                  </div>
                </article>)}
              {!course.modules.length && <p className="operations-note">No phases yet — add your first one below.</p>}
            </div>
            <AddModuleForm courseId={course._id} position={course.modules.length} nextPhaseNumber={course.modules.length + 1} onDone={refreshCourse} />

            <UnassignedQuizzesSection course={course} onDone={refreshCourse} />
          </>}
      </section>
    </div>
  </>
}
