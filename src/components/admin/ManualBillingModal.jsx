import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import Modal from '../Modal.jsx'
import { useToast } from '../../lib/toastContext.js'
import { createBillingRecord, fetchAdminCourses, fetchAdminPricing } from '../../lib/admin.js'

const standardPathways = [
  { id: 'broker', pathway: 'broker', title: 'Broker Review', slug: 'broker-review' },
  { id: 'consultant', pathway: 'consultant', title: 'Consultant Review', slug: 'consultant-review' },
  { id: 'appraiser', pathway: 'appraiser', title: 'Appraiser Review', slug: 'appraiser-review' },
]

export default function ManualBillingModal({ open, learnerId, learnerName, courses = [], initialCourseId, onClose, onCreated }) {
  const toast = useToast()
  const { data: allCourses = [] } = useQuery({ queryKey: ['admin-courses-min'], queryFn: fetchAdminCourses, enabled: open })
  const { data: pricing } = useQuery({ queryKey: ['pricing'], queryFn: fetchAdminPricing, enabled: open })

  // Build the list of selectable courses and pathways
  const { enrolledOptions, otherOptions } = useMemo(() => {
    const list = courses.length ? courses : allCourses
    const enrolled = []
    const other = []

    for (const c of list) {
      const item = {
        id: c.id ?? c._id,
        courseId: c.id ?? c._id,
        title: c.title,
        slug: c.slug,
        pathway: c.slug?.replace(/-review$/, ''),
        enrolled: Boolean(c.enrolled),
      }
      if (item.enrolled) enrolled.push(item)
      else other.push(item)
    }

    for (const p of standardPathways) {
      const exists = list.some((c) => (c.slug ?? '').startsWith(p.pathway) || (c.id ?? c._id) === p.id)
      if (!exists) {
        other.push({ id: p.id, pathway: p.pathway, title: p.title, slug: p.slug, enrolled: false })
      }
    }

    return { enrolledOptions: enrolled, otherOptions: other }
  }, [courses, allCourses])

  const [userSelectedId, setUserSelectedId] = useState(null)
  const [customAmount, setCustomAmount] = useState(null)
  const [batch, setBatch] = useState('REBLEx Batch 1')
  const [error, setError] = useState('')

  const selectedId = userSelectedId
    ?? initialCourseId
    ?? (enrolledOptions.length ? enrolledOptions[0].id : standardPathways[0].id)

  const selectedItem = useMemo(() => {
    return enrolledOptions.find((o) => o.id === selectedId)
      ?? otherOptions.find((o) => o.id === selectedId)
      ?? enrolledOptions[0]
      ?? otherOptions[0]
  }, [enrolledOptions, otherOptions, selectedId])

  const defaultAmount = useMemo(() => {
    if (!selectedItem) return '14900'
    const p = selectedItem.pathway
    if (p === 'broker') return String(pricing?.totalBroker ?? 14900)
    if (p === 'consultant') return String(pricing?.totalConsultant ?? 14900)
    if (p === 'appraiser') return String(pricing?.totalAppraiser ?? 14900)
    return '14900'
  }, [selectedItem, pricing])

  const amount = customAmount ?? defaultAmount

  const handleClose = () => {
    setUserSelectedId(null)
    setCustomAmount(null)
    setBatch('REBLEx Batch 1')
    setError('')
    onClose()
  }

  const mutation = useMutation({
    mutationFn: (body) => createBillingRecord(body),
  })

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (!selectedItem) {
      setError('Please select a course.')
      return
    }
    try {
      await mutation.mutateAsync({
        learnerId,
        courseId: selectedItem.courseId,
        pathway: selectedItem.pathway,
        batch: batch.trim() || 'REBLEx Batch 1',
        amount: amount ? Number(amount) : undefined,
      })
      toast.success(`Billing record created for ${selectedItem.title}.`)
      setUserSelectedId(null)
      setCustomAmount(null)
      onCreated()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} labelledBy="manual-billing-title" className="confirm-modal">
      <p className="eyebrow">MANUAL BILLING</p>
      <h2 id="manual-billing-title">{learnerName}</h2>
      <p className="enrollment-sent-lead">
        Add a manual billing record under the student&rsquo;s course. The student will be automatically granted access to the course and their statement will reflect this record.
      </p>
      <form className="webinar-register-form" onSubmit={submit} style={{ textAlign: 'left', marginTop: 16 }}>
        <label className="builder-field">
          <span>Course / Category</span>
          <select
            value={selectedId}
            onChange={(e) => {
              setUserSelectedId(e.target.value)
              setCustomAmount(null)
            }}
          >
            {enrolledOptions.length > 0 && (
              <optgroup label="Student's Enrolled Courses">
                {enrolledOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    ★ {item.title} (Currently Enrolled)
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label={enrolledOptions.length > 0 ? 'Other Available Courses' : 'Courses & Review Programs'}>
              {otherOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="builder-field">
          <span>Batch / Current Session</span>
          <input
            type="text"
            required
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            placeholder="e.g. REBLEx Batch 1"
          />
        </label>
        <label className="builder-field">
          <span>Billing amount (₱)</span>
          <input
            type="number"
            min={1}
            step={1}
            required
            value={amount}
            onChange={(e) => setCustomAmount(e.target.value)}
            placeholder="e.g. 14900"
          />
        </label>
        {error && <p className="form-alert" role="alert">{error}</p>}
        <div className="confirm-actions">
          <button type="button" className="button button-ghost" onClick={handleClose}>
            Cancel
          </button>
          <button className="button button-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create billing record'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
