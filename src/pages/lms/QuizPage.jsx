import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, ClipboardCheck, Play, X } from 'lucide-react'
import RichTextViewer from '../../components/RichTextViewer.jsx'
import { attemptQuiz, fetchQuiz, fetchQuizzes } from '../../lib/lms.js'

function QuizRunner({ quizId, onExit, canAttempt }) {
  const { data: quiz, isLoading } = useQuery({ queryKey: ['quiz', quizId], queryFn: () => fetchQuiz(quizId) })
  const [answers, setAnswers] = useState({})
  const attemptMutation = useMutation({ mutationFn: () => attemptQuiz(quizId, quiz.questions.map((_, index) => answers[index] ?? -1)) })
  const result = attemptMutation.data

  if (isLoading || !quiz) return <div className="learning-card quiz-preview"><div className="learning-body"><p>Loading quiz…</p></div></div>

  return <div className="learning-card quiz-preview">
    <div className="learning-head"><div><p className="eyebrow">{quiz.courseTitle}</p><h2>{quiz.title}</h2></div><span className="module-count">{quiz.questions.length} questions</span></div>
    <div style={{ padding: '18px 23px' }}>
      {result && <div className="quiz-score-banner"><strong>{result.percent}%</strong><span>{result.score} of {result.total} correct</span></div>}
      {quiz.questions.map((question, index) => {
        const questionResult = result?.results?.[index] ?? (!canAttempt ? { answerIndex: question.answerIndex, explanation: question.explanation, selectedIndex: null } : null)
        return <div className="quiz-question" key={index}>
          <h3 style={{ display: 'flex', gap: 6 }}><span>{index + 1}.</span><RichTextViewer html={question.prompt} /></h3>
          <div className="quiz-choices">
            {question.choices.map((choice, choiceIndex) => {
              let stateClass = answers[index] === choiceIndex ? 'selected' : ''
              if (questionResult) {
                if (choiceIndex === questionResult.answerIndex) stateClass = 'correct'
                else if (choiceIndex === questionResult.selectedIndex) stateClass = 'incorrect'
              }
              return <label className={`quiz-choice ${stateClass}`} key={choiceIndex}>
                <input type="radio" name={`q-${index}`} disabled={Boolean(result) || !canAttempt} checked={answers[index] === choiceIndex} onChange={() => setAnswers((current) => ({ ...current, [index]: choiceIndex }))} />
                {choice}
              </label>
            })}
          </div>
          {questionResult?.explanation && <RichTextViewer html={questionResult.explanation} className="quiz-explanation" />}
        </div>
      })}
    </div>
    <div className="button-row" style={{ padding: '0 23px 23px' }}>
      <button type="button" className="button button-ghost" onClick={onExit}><X size={15} /> Back to quizzes</button>
      {canAttempt && !result && <button type="button" className="button button-primary" disabled={attemptMutation.isPending || Object.keys(answers).length < quiz.questions.length} onClick={() => attemptMutation.mutate()}>{attemptMutation.isPending ? 'Grading…' : 'Submit answers'}</button>}
    </div>
  </div>
}

export default function QuizPage({ role }) {
  const [activeQuizId, setActiveQuizId] = useState(null)
  const { data: quizzes = [], isLoading, error } = useQuery({ queryKey: ['quizzes'], queryFn: fetchQuizzes })
  const canAttempt = role === 'learner'

  if (activeQuizId) return <><div className="page-title-row"><div><p className="eyebrow">PRACTICE WITH PURPOSE</p><h1>Quiz center</h1></div></div><QuizRunner quizId={activeQuizId} onExit={() => setActiveQuizId(null)} canAttempt={canAttempt} /></>

  return <>
    <div className="page-title-row"><div><p className="eyebrow">PRACTICE WITH PURPOSE</p><h1>Quiz center</h1><p>Use quick practice sets to check your knowledge before the next live review.</p></div></div>
    {isLoading && <div className="empty-state"><ClipboardCheck size={26} /><strong>Loading quizzes…</strong></div>}
    {error && <div className="empty-state"><ClipboardCheck size={26} /><strong>Could not load quizzes</strong><p>{error.message}</p></div>}
    {!isLoading && !error && quizzes.length === 0 && <div className="empty-state"><ClipboardCheck size={26} /><strong>No quizzes published yet</strong><p>Practice sets will appear here once your instructors publish them.</p></div>}
    <div className="assignment-table">
      {quizzes.map((quiz) => <div className="assignment-line" key={quiz._id}>
        <span className="task-check"><Check size={13} /></span>
        <div><strong>{quiz.title}</strong><small>{quiz.courseTitle} · {quiz.questionCount} questions</small></div>
        <span className="task-state soon">{canAttempt ? 'Untimed practice' : 'Preview only'}</span>
        <button type="button" onClick={() => setActiveQuizId(quiz._id)}><Play size={14} /> {canAttempt ? 'Start' : 'Preview'} <ArrowRight size={15} /></button>
      </div>)}
    </div>
  </>
}
