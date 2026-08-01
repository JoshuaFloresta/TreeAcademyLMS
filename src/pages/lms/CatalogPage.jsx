import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, BookOpen, CalendarClock, Check, ChevronDown, ClipboardCheck, ExternalLink, Layers, Minus, Pencil, Play } from 'lucide-react'
import CourseBanner from '../../components/lms/CourseBanner.jsx'
import StatusPill from '../../components/StatusPill.jsx'
import RichTextViewer from '../../components/RichTextViewer.jsx'
import { useToast } from '../../lib/toastContext.js'
import { completeModule, fetchCourse, fetchCourseCategories, fetchCourseCategory, fetchCourses, updateModule } from '../../lib/lms.js'
import Loading from '../../components/Loading.jsx'

const kindLabel = { article: 'Article', video: 'Video lesson', document: 'Document', link: 'Resource link' }
const dueLabel = (dueAt) => (dueAt ? `Due ${new Date(dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : 'No due date')

function AssignmentRow({ assignment }) {
  const submission = assignment.mySubmission
  const status = submission?.grade != null ? `Graded · ${submission.grade}/${assignment.maxPoints}` : submission ? 'Submitted' : dueLabel(assignment.dueAt)
  return <Link to={`/assignments/${assignment.id}`} className="assignment-row-link">
    <ClipboardCheck size={13} /> <strong>{assignment.title}</strong>
    <span className="assignment-row-meta">{status}</span>
    <ArrowRight size={14} />
  </Link>
}

// Each lesson is its own collapsible "section" — opening it reveals a button to the attached PDF
// plus any assignments under it.
function LessonSection({ lesson }) {
  const [open, setOpen] = useState(false)
  // A 'header' lesson is a content-less divider grouping the sections beneath it, so it renders as
  // a plain heading — matching the instructor's Course Builder — rather than a collapsible row
  // that would open to nothing and be labelled with the raw kind string.
  if (lesson.kind === 'header') return <li className="module-header-row"><span><Minus size={13} /> {lesson.title}</span></li>
  return <li className="module-lesson-item">
    <button type="button" className="lesson-section-head" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
      <ChevronDown size={14} className={`lesson-section-chevron ${open ? 'open' : ''}`} />
      <BookOpen size={13} /> {lesson.title}
      <small style={{ marginLeft: 'auto', opacity: .6 }}>{kindLabel[lesson.kind] ?? lesson.kind}</small>
    </button>
    {open && <div className="lesson-section-body">
      {lesson.body && <RichTextViewer html={lesson.body} className="assignment-block-instructions" />}
      {lesson.driveUrl
        ? <a href={lesson.driveUrl} target="_blank" rel="noreferrer" className="button button-ghost button-compact lesson-pdf-button"><ExternalLink size={14} /> View PDF</a>
        : !lesson.body && <p className="operations-note">No file attached to this section yet.</p>}
      {lesson.assignments?.map((assignment) => <AssignmentRow key={assignment.id} assignment={assignment} />)}
    </div>}
  </li>
}

const categoryBackground = (category) => (category.bannerUrl ? `url(${category.bannerUrl}) center / cover`
  : category.bannerPreset === 'gold' ? '#b58b3d' : category.bannerPreset === 'ocean' ? '#31556e' : '#1b432e')

// A learning module's content by type — file (attached resource), quiz (self-check with instant
// scoring), or assignment (instructions only; grading is not wired for this newer content type yet).
function QuizModule({ module }) {
  const [answers, setAnswers] = useState({})
  const [checked, setChecked] = useState(false)
  const questions = module.quiz?.questions ?? []
  const score = questions.length ? questions.filter((question, index) => answers[index] === question.answerIndex).length : 0
  const percent = questions.length ? Math.round((score / questions.length) * 100) : 0
  const passed = percent >= (module.quiz?.passingScore ?? 0)
  return <div className="lesson-section-body">
    {module.instructions && <p className="assignment-block-instructions">{module.instructions}</p>}
    {questions.map((question, index) => <div key={index} className="quiz-question-block" style={{ margin: '12px 0' }}>
      <strong>{index + 1}. {question.prompt}</strong>
      <div className="builder-lesson-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6, marginTop: 6 }}>
        {question.choices.map((choice, choiceIndex) => <label key={choiceIndex} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="radio" name={`quiz-${module._id}-${index}`} checked={answers[index] === choiceIndex} onChange={() => { setAnswers((current) => ({ ...current, [index]: choiceIndex })); setChecked(false) }} />
          {choice}
          {checked && choiceIndex === question.answerIndex && <Check size={13} style={{ color: '#2f7a4f' }} />}
        </label>)}
      </div>
    </div>)}
    {questions.length > 0 && <button type="button" className="button button-primary button-compact" onClick={() => setChecked(true)} disabled={Object.keys(answers).length < questions.length}>Check answers</button>}
    {checked && <p className={passed ? 'auth-notice' : 'form-alert'} style={{ marginTop: 10 }}>{score}/{questions.length} correct ({percent}%) — {passed ? 'Passed' : `Needs ${module.quiz?.passingScore ?? 0}% to pass`}</p>}
  </div>
}

function CategoryModuleSection({ module }) {
  const [open, setOpen] = useState(false)
  return <li className="module-lesson-item">
    <button type="button" className="lesson-section-head" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
      <ChevronDown size={14} className={`lesson-section-chevron ${open ? 'open' : ''}`} />
      <BookOpen size={13} /> {module.title}
      <small style={{ marginLeft: 'auto', opacity: .6 }}>{module.type}</small>
    </button>
    {open && <>
      {module.type === 'quiz' && <QuizModule module={module} />}
      {module.type === 'assignment' && <div className="lesson-section-body">
        {module.instructions && <p className="assignment-block-instructions">{module.instructions}</p>}
        <p className="operations-note">Worth {module.assignment?.maxPoints ?? 100} points.</p>
      </div>}
      {module.type === 'file' && <div className="lesson-section-body">
        {module.instructions && <p className="assignment-block-instructions">{module.instructions}</p>}
        {module.resourceUrl
          ? <a href={module.resourceUrl} target="_blank" rel="noreferrer" className="button button-ghost button-compact lesson-pdf-button"><ExternalLink size={14} /> View PDF</a>
          : !module.instructions && <p className="operations-note">No file attached to this section yet.</p>}
      </div>}
    </>}
  </li>
}

function CategoryDetailPage({ courseId, categoryId, onBack }) {
  const { data: category, isLoading } = useQuery({ queryKey: ['course-category', courseId, categoryId], queryFn: () => fetchCourseCategory(courseId, categoryId) })
  return <>
    <button type="button" className="filter-button" onClick={onBack} style={{ marginBottom: 18 }}><ArrowLeft size={15} /> Back to catalog</button>
    {isLoading && <Loading block label="Loading category…" />}
    {!isLoading && !category && <div className="empty-state"><BookOpen size={26} /><strong>Category not found</strong></div>}
    {category && <div className="course-details">
      <div className="course-details-header" style={{ background: categoryBackground(category), color: '#fff' }}>
        <div><p className="eyebrow">CATEGORY</p><h2>{category.title}</h2><p>{category.description || 'No category description yet.'}</p></div>
      </div>
      <div className="course-details-content single-column">
        {(category.headers?.length ?? 0) === 0 && <p className="operations-note">No content published in this category yet.</p>}
        {category.headers?.map((header) => <div className="course-syllabus" key={header._id}>
          <div className="course-section-heading"><h2>{header.title}</h2></div>
          <ul className="module-lesson-list">{header.modules.map((module) => <CategoryModuleSection key={module._id} module={module} />)}</ul>
        </div>)}
      </div>
    </div>}
  </>
}

// Inline phase-header editor — instructors/admins can rename a phase and its blurb right on this
// page, without a trip to Course Builder.
function PhaseHeaderEdit({ module, onCancel, onDone }) {
  const toast = useToast()
  const [values, setValues] = useState({ title: module.title, description: module.description ?? '', phaseNumber: module.phaseNumber ?? '' })
  const mutation = useMutation({
    mutationFn: () => updateModule(module._id, { title: values.title.trim(), description: values.description.trim() || null, phaseNumber: values.phaseNumber ? Number(values.phaseNumber) : null }),
    onSuccess: () => { toast.success('Phase updated.'); onDone() },
    onError: (error) => toast.error(error.message),
  })
  return <div className="phase-header-edit">
    <div className="builder-lesson-row">
      <input type="number" min={1} max={99} value={values.phaseNumber} onChange={(event) => setValues((prev) => ({ ...prev, phaseNumber: event.target.value }))} placeholder="#" aria-label="Phase number" style={{ maxWidth: 70 }} />
      <input value={values.title} onChange={(event) => setValues((prev) => ({ ...prev, title: event.target.value }))} placeholder="Phase name" aria-label="Phase name" />
    </div>
    <textarea value={values.description} onChange={(event) => setValues((prev) => ({ ...prev, description: event.target.value }))} placeholder="Phase description" rows={2} />
    <div className="builder-lesson-actions"><button type="button" className="button button-primary button-compact" disabled={mutation.isPending || values.title.trim().length < 2} onClick={() => mutation.mutate()}>Save</button><button type="button" className="button button-ghost button-compact" onClick={onCancel}>Cancel</button></div>
  </div>
}

function PhaseDetailPage({ courseId, phaseId, role, onBack }) {
  const queryClient = useQueryClient()
  const { data: course, isLoading } = useQuery({ queryKey: ['course', courseId], queryFn: () => fetchCourse(courseId) })
  const [editing, setEditing] = useState(false)
  const isStaff = role !== 'learner'
  const completeMutation = useMutation({
    mutationFn: completeModule,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['courses'] }); queryClient.invalidateQueries({ queryKey: ['course', courseId] }) },
  })
  const moduleIndex = course?.modules?.findIndex((item) => item._id === phaseId) ?? -1
  const module = moduleIndex >= 0 ? course.modules[moduleIndex] : null
  const refresh = () => { setEditing(false); queryClient.invalidateQueries({ queryKey: ['course', courseId] }) }

  return <>
    <button type="button" className="filter-button" onClick={onBack} style={{ marginBottom: 18 }}><ArrowLeft size={15} /> Back to catalog</button>
    {isLoading && <Loading block label="Loading phase…" />}
    {!isLoading && !module && <div className="empty-state"><BookOpen size={26} /><strong>Phase not found</strong></div>}
    {module && <div className="course-details">
      <div className="course-details-header">
        {editing
          ? <div style={{ flex: 1 }}><PhaseHeaderEdit module={module} onCancel={() => setEditing(false)} onDone={refresh} /></div>
          : <div>
            <p className="eyebrow">{course.title} · PHASE {module.phaseNumber ?? moduleIndex + 1}</p>
            <h2>{module.title}{isStaff && <button type="button" className="phase-edit-trigger" onClick={() => setEditing(true)} aria-label="Edit phase"><Pencil size={15} /></button>}</h2>
            <p>{module.description || 'No phase description yet.'}</p>
          </div>}
        <div className="course-details-facts">
          <span><Layers size={14} /> {module.lessons?.length ?? 0} sections</span>
          <span><CalendarClock size={14} /> Self-paced</span>
        </div>
      </div>
      <div className="course-details-content single-column">
        <div className="course-syllabus">
          <div className="course-section-heading"><h2>Sections</h2></div>
          {(module.lessons?.length ?? 0) === 0 && <p className="operations-note">No sections published in this phase yet.</p>}
          <ul className="module-lesson-list">{module.lessons?.map((lesson) => <LessonSection key={lesson._id} lesson={lesson} />)}</ul>
          {module.assignments?.map((assignment) => <AssignmentRow key={assignment.id} assignment={assignment} />)}
          {role === 'learner' && <button type="button" className="module-complete-button" disabled={module.completed || completeMutation.isPending} onClick={() => completeMutation.mutate(module._id)} style={{ marginTop: 16 }}>{module.completed ? 'Completed' : completeMutation.isPending ? 'Saving…' : 'Mark phase complete'}</button>}
        </div>
      </div>
    </div>}
  </>
}

function PhaseGrid({ role, onOpenPhase, onOpenCategory }) {
  const [courseId, setCourseId] = useState('')
  const { data: courses = [], isLoading: coursesLoading, error } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses })
  const isStaff = role !== 'learner'
  const activeCourseId = courseId || courses[0]?._id || ''
  const { data: course, isLoading } = useQuery({ queryKey: ['course', activeCourseId], queryFn: () => fetchCourse(activeCourseId), enabled: Boolean(activeCourseId) })
  const { data: categories = [] } = useQuery({ queryKey: ['course-categories', activeCourseId], queryFn: () => fetchCourseCategories(activeCourseId), enabled: Boolean(activeCourseId) })

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">ALL-ACCESS LIBRARY</p><h1>Modules catalog</h1><p>{!isStaff && courses.length > 1 ? 'Choose a program to see its review phases.' : 'Your review phases, in order.'}</p></div>
      {isStaff && courses.length > 1 && <select value={activeCourseId} onChange={(event) => setCourseId(event.target.value)} className="filter-button" aria-label="Select course">{courses.map((item) => <option key={item._id} value={item._id}>{item.title}</option>)}</select>}
    </div>
    {/* A learner approved for more than one pathway holds several courses, but the page only ever
        rendered courses[0] — the switcher above was staff-only, leaving the second program with no
        way in. Tabs rather than a dropdown: a learner has a handful of programs, and showing their
        names side by side makes it obvious a second one exists. */}
    {!isStaff && courses.length > 1 && <div className="course-tabs" role="tablist" aria-label="Select program">
      {courses.map((item) => <button
        type="button"
        key={item._id}
        role="tab"
        aria-selected={item._id === activeCourseId}
        className={`course-tab ${item._id === activeCourseId ? 'active' : ''}`}
        onClick={() => setCourseId(item._id)}
      >
        <BookOpen size={15} />
        <span>{item.title}</span>
        <StatusPill kind={(item.progressPercent ?? 0) >= 100 ? 'green' : 'gold'}>{item.progressPercent ?? 0}%</StatusPill>
      </button>)}
    </div>}
    {coursesLoading && <Loading block label="Loading…" />}
    {error && <div className="empty-state"><BookOpen size={26} /><strong>Could not load your course</strong><p>{error.message}</p></div>}
    {!coursesLoading && !error && courses.length === 0 && <div className="empty-state"><BookOpen size={26} /><strong>No course access yet</strong><p>Once your enrollment is approved, your review phases will appear here.</p></div>}
    {isLoading && activeCourseId && <Loading block label="Loading phases…" />}
    {course && <div className="catalog-grid">
      {categories.map((category, index) => <article className="catalog-card" key={category._id}>
        <div className="catalog-image preset" style={{ background: categoryBackground(category) }}><span>{String(index + 1).padStart(2, '0')}</span></div>
        <div>
          <p className="eyebrow">CATEGORY {index + 1}</p><h2>{category.title}</h2><p>{category.description || 'Category description coming soon.'}</p>
          <div className="catalog-foot">
            <span className="progress-label"><Play size={12} /> {category.status === 'published' ? 'Available' : category.status}</span>
            <button type="button" onClick={() => onOpenCategory(activeCourseId, category._id)} aria-label={`View ${category.title}`}><ArrowRight size={18} /></button>
          </div>
        </div>
      </article>)}
      {course.modules.length === 0 && <p className="operations-note">No phases published for this course yet.</p>}
      {course.modules.map((module, index) => <article className="catalog-card" key={module._id}>
        <CourseBanner course={course} index={index}><span>{String(module.phaseNumber ?? index + 1).padStart(2, '0')}</span></CourseBanner>
        <div>
          <p className="eyebrow">PHASE {module.phaseNumber ?? index + 1}</p>
          <h2>{module.title}</h2>
          <p>{module.description || 'Phase description coming soon.'}</p>
          <div className="catalog-foot">
            <span className="progress-label">{module.completed ? <Check size={14} /> : <Play size={12} />} {module.completed ? 'Completed' : 'Not started'}</span>
            <button type="button" onClick={() => onOpenPhase(activeCourseId, module._id)} aria-label={`View ${module.title}`}><ArrowRight size={18} /></button>
          </div>
        </div>
      </article>)}
    </div>}
  </>
}

export default function CatalogPage({ role }) {
  const [params, setParams] = useSearchParams()
  const courseId = params.get('course')
  const phaseId = params.get('phase')
  const categoryId = params.get('category')

  if (courseId && phaseId) return <PhaseDetailPage courseId={courseId} phaseId={phaseId} role={role} onBack={() => setParams({})} />
  if (courseId && categoryId) return <CategoryDetailPage courseId={courseId} categoryId={categoryId} onBack={() => setParams({})} />
  return <PhaseGrid role={role} onOpenPhase={(course, phase) => setParams({ course, phase })} onOpenCategory={(course, category) => setParams({ course, category })} />
}
