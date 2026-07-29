// Shared helpers for the instructor course builder and its assignment/quiz editor pages.
export const toLocalInput = (value) => { if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
export const dueLabel = (value) => (value ? `Due ${new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : 'No due date')
export const submissionTypeLabel = { text: 'Text response only', file: 'File upload only', both: 'Text or file' }

export const questionTypes = [
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'true_false', label: 'True / False' },
  { value: 'fill_blank', label: 'Fill in the blank' },
  { value: 'essay', label: 'Essay' },
  { value: 'matching', label: 'Matching / Pairing' },
  { value: 'enumeration', label: 'Enumeration' },
]

let nextQuestionKey = 0
const questionKey = () => `q${Date.now()}-${nextQuestionKey++}`

export function blankQuestion(type = 'multiple_choice') {
  const base = { key: questionKey(), type, prompt: '', choices: ['', ''], answerIndex: 0, acceptableAnswers: [''], minAnswers: 1, pairs: [{ left: '', right: '' }, { left: '', right: '' }], explanation: '' }
  if (type === 'true_false') return { ...base, choices: ['True', 'False'] }
  return { ...base, type }
}

export function questionPayload(question) {
  const base = { type: question.type, prompt: question.prompt.trim(), explanation: question.explanation?.trim() || undefined }
  if (question.type === 'multiple_choice' || question.type === 'true_false') return { ...base, choices: question.choices.map((choice) => choice.trim()).filter(Boolean), answerIndex: question.answerIndex }
  if (question.type === 'fill_blank') return { ...base, acceptableAnswers: question.acceptableAnswers.map((answer) => answer.trim()).filter(Boolean) }
  if (question.type === 'essay') return base
  if (question.type === 'matching') return { ...base, pairs: question.pairs.map((pair) => ({ left: pair.left.trim(), right: pair.right.trim() })).filter((pair) => pair.left && pair.right) }
  if (question.type === 'enumeration') return { ...base, acceptableAnswers: question.acceptableAnswers.map((answer) => answer.trim()).filter(Boolean), minAnswers: Number(question.minAnswers) || 1 }
  return base
}

const plainTextLength = (html) => (html || '').replace(/<[^>]*>/g, '').trim().length

export function questionIsValid(question) {
  if (plainTextLength(question.prompt) < 2) return false
  if (question.type === 'multiple_choice' || question.type === 'true_false') return question.choices.filter((choice) => choice.trim()).length >= 2 && question.answerIndex < question.choices.length
  if (question.type === 'fill_blank') return question.acceptableAnswers.some((answer) => answer.trim())
  if (question.type === 'essay') return true
  if (question.type === 'matching') return question.pairs.filter((pair) => pair.left.trim() && pair.right.trim()).length >= 2
  if (question.type === 'enumeration') { const filled = question.acceptableAnswers.filter((answer) => answer.trim()); return filled.length >= 1 && Number(question.minAnswers) <= filled.length }
  return false
}
