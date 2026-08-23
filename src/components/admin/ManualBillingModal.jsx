import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import Modal from '../Modal.jsx'
import { useToast } from '../../lib/toastContext.js'
import { createBillingRecord } from '../../lib/admin.js'

const pathwayLabel = { broker: 'Broker Review', consultant: 'Consultant Review', appraiser: 'Appraiser Review' }

// Creates an origin:'manual' Enrollment for a learner who was added directly (Create user / CSV
// import) rather than through the public enrollment flow — no admission form, no signed agreement,
// so it can't be faked into a real one. The amount defaults to the pathway's current price; staff
// can edit it, add a fee breakdown, and record payments against it afterward from the same
// "Enrollment & billing" panel (BillingDetailModal) exactly like any other enrollment.
export default function ManualBillingModal({ open, learnerId, learnerName, onClose, onCreated }) {
  const [pathway, setPathway] = useState('consultant')
  const [error, setError] = useState('')
  const toast = useToast()
  const mutation = useMutation({ mutationFn: () => createBillingRecord({ learnerId, pathway }) })
  const submit = async (event) => {
    event.preventDefault()
    setError('')
    try { await mutation.mutateAsync(); toast.success('Billing record created.'); onCreated() }
    catch (e) { setError(e.message) }
  }
  return <Modal open={open} onClose={onClose} labelledBy="manual-billing-title" className="confirm-modal">
    <p className="eyebrow">MANUAL BILLING</p>
    <h2 id="manual-billing-title">{learnerName}</h2>
    <p className="enrollment-sent-lead">For a learner onboarded outside the public enrollment flow. The price comes from the program&rsquo;s current pricing — edit it afterward from the billing record if this learner's price differs.</p>
    <form className="webinar-register-form" onSubmit={submit} style={{ textAlign: 'left', marginTop: 16 }}>
      <label className="builder-field"><span>Program</span><select value={pathway} onChange={(event) => setPathway(event.target.value)}>{Object.entries(pathwayLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className="confirm-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Creating…' : 'Create record'}</button></div>
    </form>
  </Modal>
}
