import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, HelpCircle, Plus, Trash2 } from 'lucide-react'
import RichTextEditor from '../../../components/RichTextEditor.jsx'
import { useToast } from '../../../lib/toastContext.js'
import { createQuiz, fetchCourse, fetchQuiz, updateQuiz } from '../../../lib/lms.js'
import { blankQuestion, questionIsValid, questionPayload, questionTypes } from './builderShared.js'
import Loading from '../../../components/Loading.jsx'

function QuestionEditor({ question, index, total, setQuestion, setQuestionType, setChoice, setAcceptableAnswer, setPair, removeQuestion }) {
  return <div className="builder-editor-section builder-question">
    <div className="builder-question-head">
      <strong>Question {index + 1}</strong>
      <select value={question.type} onChange={(event) => setQuestionType(index, event.target.value)} aria-label="Question type" style={{ marginLeft: 'auto' }}>
        {questionTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
      {total > 1 && <button type="button" className="builder-danger" onClick={() => removeQuestion(index)} aria-label="Remove question"><Trash2 size={13} /></button>}
    </div>
    <label className="builder-field"><span>Prompt</span><RichTextEditor value={question.prompt} onChange={(html) => setQuestion(index, { prompt: html })} placeholder="Question prompt" ariaLabel="Question prompt" /></label>

    {(question.type === 'multiple_choice' || question.type === 'true_false') && <>
      {question.choices.map((choice, cIndex) => <label className="builder-choice" key={cIndex}>
        <input type="radio" name={`correct-${question.key}`} checked={question.answerIndex === cIndex} onChange={() => setQuestion(index, { answerIndex: cIndex })} aria-label={`Mark choice ${cIndex + 1} correct`} />
        {question.type === 'true_false'
          ? <span className="builder-choice-text" style={{ padding: '8px 0' }}>{choice}</span>
          : <input className="builder-choice-text" value={choice} onChange={(event) => setChoice(index, cIndex, event.target.value)} placeholder={`Choice ${cIndex + 1}`} />}
        {question.type === 'multiple_choice' && question.choices.length > 2 && <button type="button" className="builder-danger" onClick={() => setQuestion(index, { choices: question.choices.filter((_, position) => position !== cIndex), answerIndex: 0 })} aria-label="Remove choice"><Trash2 size={12} /></button>}
      </label>)}
      {question.type === 'multiple_choice' && question.choices.length < 6 && <button type="button" className="builder-add-lesson" onClick={() => setQuestion(index, { choices: [...question.choices, ''] })}><Plus size={12} /> Add choice</button>}
    </>}

    {(question.type === 'fill_blank' || question.type === 'enumeration') && <div style={{ display: 'grid', gap: 6 }}>
      {question.acceptableAnswers.map((answer, aIndex) => <label className="builder-choice" key={aIndex}>
        <input className="builder-choice-text" value={answer} onChange={(event) => setAcceptableAnswer(index, aIndex, event.target.value)} placeholder={`Acceptable answer ${aIndex + 1}`} />
        {question.acceptableAnswers.length > 1 && <button type="button" className="builder-danger" onClick={() => setQuestion(index, { acceptableAnswers: question.acceptableAnswers.filter((_, position) => position !== aIndex) })} aria-label="Remove answer"><Trash2 size={12} /></button>}
      </label>)}
      <button type="button" className="builder-add-lesson" onClick={() => setQuestion(index, { acceptableAnswers: [...question.acceptableAnswers, ''] })}><Plus size={12} /> Add acceptable answer</button>
      <p className="operations-note">Matches are case-insensitive and ignore extra spaces.</p>
      {question.type === 'enumeration' && <label className="builder-field"><span>Minimum correct answers required</span><input type="number" min={1} max={question.acceptableAnswers.length || 1} value={question.minAnswers} onChange={(event) => setQuestion(index, { minAnswers: event.target.value })} /></label>}
    </div>}

    {question.type === 'essay' && <p className="operations-note">Learners submit a free-response answer here — this is self-review only and isn't auto-graded.</p>}

    {question.type === 'matching' && <div style={{ display: 'grid', gap: 6 }}>
      {question.pairs.map((pair, pIndex) => <div className="builder-lesson-row" key={pIndex}>
        <input value={pair.left} onChange={(event) => setPair(index, pIndex, 'left', event.target.value)} placeholder="Left item" />
        <input value={pair.right} onChange={(event) => setPair(index, pIndex, 'right', event.target.value)} placeholder="Matches with…" />
        {question.pairs.length > 2 && <button type="button" className="builder-danger" onClick={() => setQuestion(index, { pairs: question.pairs.filter((_, position) => position !== pIndex) })} aria-label="Remove pair"><Trash2 size={12} /></button>}
      </div>)}
      {question.pairs.length < 12 && <button type="button" className="builder-add-lesson" onClick={() => setQuestion(index, { pairs: [...question.pairs, { left: '', right: '' }] })}><Plus size={12} /> Add pair</button>}
    </div>}

    <label className="builder-field">
      <span>Explanation / sample answer (optional, shown after submitting)</span>
      <RichTextEditor value={question.explanation} onChange={(html) => setQuestion(index, { explanation: html })} placeholder="Explain the correct answer…" ariaLabel="Explanation" />
    </label>
  </div>
}

function QuizFields({ quizId, courseId, course, initial, initialModuleId, initialPosition, onDone, onCancel }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [moduleId, setModuleId] = useState(initial?.moduleId ? String(initial.moduleId) : (initialModuleId || course.modules[0]?._id || ''))
  const [questions, setQuestions] = useState(initial?.questions?.length ? initial.questions.map((question) => ({ ...blankQuestion(question.type ?? 'multiple_choice'), ...question, type: question.type ?? 'multiple_choice' })) : [blankQuestion()])
  const [isPublished, setIsPublished] = useState(Boolean(initial?.isPublished))
  const [error, setError] = useState('')
  const toast = useToast()
  const modules = course.modules

  const setQuestion = (index, patch) => setQuestions((prev) => prev.map((question, position) => (position === index ? { ...question, ...patch } : question)))
  const setQuestionType = (index, type) => setQuestions((prev) => prev.map((question, position) => (position === index ? { ...blankQuestion(type), key: question.key, prompt: question.prompt, explanation: question.explanation } : question)))
  const setChoice = (qIndex, cIndex, value) => setQuestion(qIndex, { choices: questions[qIndex].choices.map((choice, position) => (position === cIndex ? value : choice)) })
  const setAcceptableAnswer = (qIndex, aIndex, value) => setQuestion(qIndex, { acceptableAnswers: questions[qIndex].acceptableAnswers.map((answer, position) => (position === aIndex ? value : answer)) })
  const setPair = (qIndex, pIndex, side, value) => setQuestion(qIndex, { pairs: questions[qIndex].pairs.map((pair, position) => (position === pIndex ? { ...pair, [side]: value } : pair)) })
  const removeQuestion = (index) => setQuestions((prev) => prev.filter((_, position) => position !== index))

  const payload = () => ({ title: title.trim(), moduleId: moduleId || null, position: initial ? initial.position : initialPosition, isPublished, questions: questions.map(questionPayload) })
  const mutation = useMutation({ mutationFn: () => (quizId ? updateQuiz(quizId, payload()) : createQuiz(courseId, payload())) })
  const submit = async (event) => {
    event.preventDefault()
    if (title.trim().length < 2) { setError('Add a quiz title.'); return }
    if (questions.some((question) => !questionIsValid(question))) { setError('Every question needs a prompt and enough filled-in answers for its type.'); return }
    setError('')
    try { await mutation.mutateAsync(); toast.success(quizId ? 'Quiz updated.' : 'Quiz created.'); onDone() } catch (e) { setError(e.message) }
  }
  return <form className="builder-editor-form" onSubmit={submit}>
    <div className="builder-editor-section">
      <p className="builder-editor-section-title">Quiz title</p>
      <label className="builder-field"><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Quiz title" aria-label="Quiz title" /></label>
      <label className="builder-field" style={{ marginTop: 14 }}><span>Phase</span><select value={moduleId} onChange={(event) => setModuleId(event.target.value)}><option value="">Unassigned</option>{modules.map((module, index) => <option key={module._id} value={module._id}>Phase {module.phaseNumber ?? index + 1}: {module.title}</option>)}</select></label>
    </div>
    {questions.map((question, qIndex) => <QuestionEditor
      key={question.key}
      question={question}
      index={qIndex}
      total={questions.length}
      setQuestion={setQuestion}
      setQuestionType={setQuestionType}
      setChoice={setChoice}
      setAcceptableAnswer={setAcceptableAnswer}
      setPair={setPair}
      removeQuestion={removeQuestion}
    />)}
    <button type="button" className="builder-add-lesson" onClick={() => setQuestions((prev) => [...prev, blankQuestion()])}><Plus size={13} /> Add question</button>
    <label className="builder-publish-check"><input type="checkbox" checked={isPublished} onChange={(event) => setIsPublished(event.target.checked)} /> Published (visible to learners)</label>
    <div className="builder-lesson-actions"><button className="button button-primary button-compact" disabled={mutation.isPending}>{quizId ? 'Save changes' : 'Create quiz'}</button><button type="button" className="button button-ghost button-compact" onClick={onCancel}>Cancel</button></div>
    {error && <span className="builder-error">{error}</span>}
  </form>
}

// Full-page quiz authoring flow (replaces the old in-modal composer) — question prompts and
// explanations use RichTextEditor so instructors can format/emphasize/list without cramming
// everything into a single-line input.
export default function QuizEditorPage({ role, quizId }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const isNew = !quizId
  const courseId = isNew ? searchParams.get('course') : undefined
  const initialModuleId = searchParams.get('module') ?? ''
  const initialPosition = Number(searchParams.get('position') ?? 0)
  const { data: loaded, isLoading } = useQuery({ queryKey: ['quiz', quizId], queryFn: () => fetchQuiz(quizId), enabled: !isNew })
  const resolvedCourseId = isNew ? courseId : loaded?.courseId
  const { data: course } = useQuery({ queryKey: ['builder-course', resolvedCourseId], queryFn: () => fetchCourse(resolvedCourseId), enabled: Boolean(resolvedCourseId) })

  const done = () => {
    for (const key of [['quizzes'], ['builder-course', resolvedCourseId], ['staff-overview']]) queryClient.invalidateQueries({ queryKey: key })
    navigate(-1)
  }

  if (role === 'learner') return <p className="operations-note">This workspace is available to instructors and admins only.</p>

  return <>
    <div className="page-title-row builder-editor-page-title">
      <div><p className="eyebrow">TEACHING WORKSPACE</p><h1><HelpCircle size={26} style={{ verticalAlign: 'middle', marginRight: 8 }} />{isNew ? 'Create quiz' : 'Edit quiz'}</h1>{course && <p>{course.title}</p>}</div>
    </div>
    <button type="button" className="filter-button builder-back-button" onClick={() => navigate(-1)}><ArrowLeft size={15} /> Back to course builder</button>
    <div className="course-details builder-phase-editor">
      <div className="builder-editor-page-body wide">
        {!isNew && isLoading && <Loading label="Loading quiz…" />}
        {isNew && !courseId && <p className="form-alert" role="alert">No course selected. Go back and choose a course first.</p>}
        {(isNew ? Boolean(courseId) : Boolean(loaded)) && !course && <Loading label="Loading…" />}
        {(isNew ? Boolean(courseId) : Boolean(loaded)) && course && <QuizFields quizId={quizId} courseId={courseId} course={course} initial={loaded} initialModuleId={initialModuleId} initialPosition={initialPosition} onDone={done} onCancel={() => navigate(-1)} />}
      </div>
    </div>
  </>
}
