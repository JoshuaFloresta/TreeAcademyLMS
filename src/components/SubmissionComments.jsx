import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Send } from 'lucide-react'
import { fetchSubmissionComments, postSubmissionComment } from '../lib/lms.js'

const timeLabel = (value) => new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// Threaded back-and-forth on a single submission — lighter weight than the grade's one-shot
// `feedback` field, and open to both the learner and any staff member viewing the submission.
export default function SubmissionComments({ submissionId }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const { data: comments = [], isLoading } = useQuery({ queryKey: ['submission-comments', submissionId], queryFn: () => fetchSubmissionComments(submissionId), enabled: Boolean(submissionId) })
  const mutation = useMutation({
    mutationFn: (body) => postSubmissionComment(submissionId, body),
    onSuccess: () => { setDraft(''); queryClient.invalidateQueries({ queryKey: ['submission-comments', submissionId] }) },
  })
  const submit = (event) => {
    event.preventDefault()
    if (!draft.trim()) return
    mutation.mutate(draft.trim())
  }
  return <div className="submission-comments">
    <p className="submission-comments-label"><MessageCircle size={13} /> Comments</p>
    <div className="submission-comments-list">
      {isLoading && <p className="operations-note">Loading comments…</p>}
      {!isLoading && !comments.length && <p className="operations-note">No comments yet — start the conversation below.</p>}
      {comments.map((comment) => <div className="submission-comment" key={comment.id}>
        <div className="submission-comment-head"><strong>{comment.author?.name ?? 'Unknown'}</strong><span className={`submission-comment-role ${comment.authorRole}`}>{comment.authorRole === 'learner' ? 'Learner' : 'Instructor'}</span><small>{timeLabel(comment.createdAt)}</small></div>
        <p>{comment.body}</p>
      </div>)}
    </div>
    <form className="submission-comment-form" onSubmit={submit}>
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a comment…" rows={2} />
      <button type="submit" className="button button-primary button-compact" disabled={mutation.isPending || !draft.trim()}><Send size={13} /> Send</button>
    </form>
    {mutation.isError && <p className="form-alert" role="alert">{mutation.error.message}</p>}
  </div>
}
