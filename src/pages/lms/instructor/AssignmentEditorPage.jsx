import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ClipboardList } from 'lucide-react'
import RichTextEditor from '../../../components/RichTextEditor.jsx'
import { useToast } from '../../../lib/toastContext.js'
import { createAssignment, fetchAssignment, fetchCourse, updateAssignment } from '../../../lib/lms.js'
import { toLocalInput } from './builderShared.js'
import Loading from '../../../components/Loading.jsx'

function AssignmentFields({ course, assignment, initialModuleId, initialPosition, onDone, onCancel }) {
  const [values, setValues] = useState({
    title: assignment?.title ?? '',
    instructions: assignment?.instructions ?? '',
    instructionsUrl: assignment?.instructionsUrl ?? '',
    moduleId: assignment?.moduleId ? String(assignment.moduleId) : (initialModuleId || course.modules[0]?._id || ''),
    lessonId: assignment?.lessonId ? String(assignment.lessonId) : '',
    dueAt: toLocalInput(assignment?.dueAt),
    maxPoints: assignment?.maxPoints ?? 100,
    submissionType: assignment?.submissionType ?? 'both',
  })
  const [error, setError] = useState('')
  const toast = useToast()
  const modules = course.modules
  const lessonsForModule = modules.find((module) => module._id === values.moduleId)?.lessons ?? []
  const payload = () => ({
    title: values.title.trim(), instructions: values.instructions.trim() || undefined,
    instructionsUrl: values.instructionsUrl.trim() || null,
    moduleId: values.moduleId, lessonId: values.lessonId || null,
    dueAt: values.dueAt || undefined, maxPoints: Number(values.maxPoints) || 100,
    submissionType: values.submissionType,
    position: assignment ? assignment.position : initialPosition,
  })
  const mutation = useMutation({ mutationFn: () => (assignment ? updateAssignment(assignment._id, payload()) : createAssignment(course._id, payload())) })
  const submit = async (event) => {
    event.preventDefault()
    if (values.title.trim().length < 2 || !values.moduleId) return
    if (values.instructionsUrl.trim() && !/^https?:\/\//.test(values.instructionsUrl.trim())) { setError('The instructions link must start with http:// or https://'); return }
    setError('')
    try { await mutation.mutateAsync(); toast.success(assignment ? 'Assignment updated.' : 'Assignment created.'); onDone() } catch (e) { setError(e.message) }
  }
  return <form className="builder-editor-form" onSubmit={submit}>
    <div className="builder-editor-section">
      <p className="builder-editor-section-title">Details</p>
      <label className="builder-field"><span>Assignment title</span><input value={values.title} onChange={(event) => setValues((prev) => ({ ...prev, title: event.target.value }))} placeholder="Assignment title" aria-label="Assignment title" /></label>
      <div className="builder-lesson-row" style={{ marginTop: 14 }}>
        <label className="builder-field"><span>Phase</span><select value={values.moduleId} onChange={(event) => setValues((prev) => ({ ...prev, moduleId: event.target.value, lessonId: '' }))}>{modules.map((module, index) => <option key={module._id} value={module._id}>Phase {module.phaseNumber ?? index + 1}: {module.title}</option>)}</select></label>
        <label className="builder-field"><span>Lesson (optional)</span><select value={values.lessonId} onChange={(event) => setValues((prev) => ({ ...prev, lessonId: event.target.value }))}><option value="">Whole phase</option>{lessonsForModule.map((lesson) => <option key={lesson._id} value={lesson._id}>{lesson.title}</option>)}</select></label>
      </div>
    </div>

    <div className="builder-editor-section">
      <p className="builder-editor-section-title">Instructions</p>
      <RichTextEditor value={values.instructions} onChange={(html) => setValues((prev) => ({ ...prev, instructions: html }))} placeholder="Explain what learners need to do…" ariaLabel="Assignment instructions" />
      <label className="builder-field" style={{ marginTop: 14 }}><span>Instructions PDF link (optional)</span><input value={values.instructionsUrl} onChange={(event) => setValues((prev) => ({ ...prev, instructionsUrl: event.target.value }))} placeholder="https://drive.google.com/…" aria-label="Instructions link" /></label>
    </div>

    <div className="builder-editor-section">
      <p className="builder-editor-section-title">Scheduling &amp; submissions</p>
      <div className="builder-lesson-row">
        <label className="builder-field"><span>Due date</span><input type="datetime-local" value={values.dueAt} onChange={(event) => setValues((prev) => ({ ...prev, dueAt: event.target.value }))} /></label>
        <label className="builder-field"><span>Max points</span><input type="number" min={1} max={1000} value={values.maxPoints} onChange={(event) => setValues((prev) => ({ ...prev, maxPoints: event.target.value }))} /></label>
      </div>
      <label className="builder-field" style={{ marginTop: 14 }}>
        <span>How can learners submit?</span>
        <select value={values.submissionType} onChange={(event) => setValues((prev) => ({ ...prev, submissionType: event.target.value }))}>
          <option value="both">Text response or file upload</option>
          <option value="text">Text response only</option>
          <option value="file">File upload only</option>
        </select>
      </label>
    </div>

    <div className="builder-lesson-actions"><button className="button button-primary button-compact" disabled={mutation.isPending || !modules.length}>{assignment ? 'Save changes' : 'Create assignment'}</button><button type="button" className="button button-ghost button-compact" onClick={onCancel}>Cancel</button></div>
    {!modules.length && <span className="builder-error">Add a phase to this course before creating an assignment.</span>}
    {error && <span className="builder-error">{error}</span>}
  </form>
}

// Full-page assignment authoring flow (replaces the old in-modal form) so instructors get room to
// write rich, formatted instructions instead of a cramped textarea.
export default function AssignmentEditorPage({ role, assignmentId }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const isNew = !assignmentId
  const { data: existing, isLoading: assignmentLoading } = useQuery({ queryKey: ['assignment', assignmentId], queryFn: () => fetchAssignment(assignmentId), enabled: !isNew })
  const courseId = isNew ? searchParams.get('course') : existing?.courseId
  const { data: course, isLoading: courseLoading } = useQuery({ queryKey: ['builder-course', courseId], queryFn: () => fetchCourse(courseId), enabled: Boolean(courseId) })
  const initialModuleId = searchParams.get('module') ?? ''
  const initialPosition = Number(searchParams.get('position') ?? 0)

  const done = () => {
    for (const key of [['assignments'], ['builder-course', courseId], ['staff-overview']]) queryClient.invalidateQueries({ queryKey: key })
    navigate(-1)
  }

  if (role === 'learner') return <p className="operations-note">This workspace is available to instructors and admins only.</p>

  return <>
    <div className="page-title-row builder-editor-page-title">
      <div><p className="eyebrow">TEACHING WORKSPACE</p><h1><ClipboardList size={26} style={{ verticalAlign: 'middle', marginRight: 8 }} />{isNew ? 'Create assignment' : 'Edit assignment'}</h1>{course && <p>{course.title}</p>}</div>
    </div>
    <button type="button" className="filter-button builder-back-button" onClick={() => navigate(-1)}><ArrowLeft size={15} /> Back to course builder</button>
    <div className="course-details builder-phase-editor">
      <div className="builder-editor-page-body">
        {!courseId && <p className="form-alert" role="alert">No course selected. Go back and choose a course first.</p>}
        {courseId && (assignmentLoading || courseLoading) && <Loading label="Loading…" />}
        {courseId && !assignmentLoading && !courseLoading && !course && <p className="form-alert" role="alert">Could not load this course.</p>}
        {courseId && course && (isNew || existing) && <AssignmentFields course={course} assignment={isNew ? null : existing} initialModuleId={initialModuleId} initialPosition={initialPosition} onDone={done} onCancel={() => navigate(-1)} />}
      </div>
    </div>
  </>
}
