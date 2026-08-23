import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import Modal from '../Modal.jsx'
import { useToast } from '../../lib/toastContext.js'
import { setEnrollmentBalanceDue } from '../../lib/admin.js'

const rowId = (row) => row._id ?? row.id

// Lets staff set the reminder shown on the learner's own Statement of Account for what they still
// owe on a "pay upfront only" plan — purely informational, doesn't collect anything itself. Shared
// by every staff screen that manages a learner's balance (User Management today). Render this
// conditionally with a `key={rowId(row)}` at the call site (see AdminUsersPage) rather than always
// mounting it with a nullable `row` — otherwise the date/note fields, whose initial value is only
// read once on mount, would carry a previous learner's draft into the next one opened.
export default function BalanceDueModal({ row, onClose, onSaved }) {
  const [dueDate, setDueDate] = useState(row?.payment?.balanceDueDate ? new Date(row.payment.balanceDueDate).toISOString().slice(0, 10) : '')
  const [note, setNote] = useState(row?.payment?.balanceNote ?? '')
  const toast = useToast()
  const mutation = useMutation({ mutationFn: () => setEnrollmentBalanceDue(rowId(row), { balanceDueDate: dueDate || null, balanceNote: note.trim() || null }) })
  const save = async (event) => {
    event.preventDefault()
    try { await mutation.mutateAsync(); toast.success('Balance due date updated.'); onSaved() }
    catch (e) { toast.error(e.message) }
  }
  return <Modal open={Boolean(row)} onClose={onClose} labelledBy="balance-due-title" className="confirm-modal">
    <p className="eyebrow">BALANCE DUE</p>
    <h2 id="balance-due-title">{row?.applicant?.name}</h2>
    <form className="webinar-register-form" onSubmit={save} style={{ textAlign: 'left', marginTop: 16 }}>
      <label className="builder-field"><span>Due date</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
      <label className="builder-field"><span>Note (optional, shown to the learner)</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Please settle by this date to keep your access active." /></label>
      <div className="confirm-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save'}</button></div>
    </form>
  </Modal>
}
