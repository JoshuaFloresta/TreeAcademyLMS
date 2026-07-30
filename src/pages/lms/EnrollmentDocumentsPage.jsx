import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, Filter, Search, X } from 'lucide-react'
import EnrollmentDocumentLinks from '../../components/EnrollmentDocumentLinks.jsx'
import Loading from '../../components/Loading.jsx'
import StatCard from '../../components/lms/StatCard.jsx'
import StatusPill from '../../components/StatusPill.jsx'
import { fetchAdminEnrollments } from '../../lib/admin.js'

const pathwayLabel = { broker: 'Broker Review', consultant: 'Consultant Review', appraiser: 'Appraiser Review' }
const statusLabel = {
  application_pending: 'Application started', documents_pending: 'Awaiting signature', documents_complete: 'Agreement signed',
  payment_pending: 'Awaiting payment', contract_pending: 'Awaiting signature', contract_signed: 'Agreement signed',
  paid_approval_pending: 'Paid · awaiting approval', approved: 'Approved', rejected: 'Rejected', refunded: 'Refunded',
}
const pillKind = (status) => (status === 'approved' ? 'green' : status === 'rejected' || status === 'refunded' ? 'red' : status === 'paid_approval_pending' ? 'gold' : 'green')
const rowId = (row) => row._id ?? row.id
const formatDate = (value) => (value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

// A standing archive of what every applicant submitted during enrollment — the admission form and
// the signed pathway agreement — separate from Enrollment Management's approve/reject workflow so
// instructors (who can't approve enrollments) still have a direct way to pull up a learner's paperwork.
export default function EnrollmentDocumentsPage() {
  const [term, setTerm] = useState('')
  const [pathway, setPathway] = useState('')
  const { data: enrollments = [], isLoading, error } = useQuery({ queryKey: ['admin-enrollments', 'all'], queryFn: () => fetchAdminEnrollments({ archived: 'all' }) })

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase()
    return enrollments.filter((row) => {
      if (needle && !(row.applicant?.name?.toLowerCase().includes(needle) || row.applicant?.email?.toLowerCase().includes(needle))) return false
      if (pathway && row.applicant?.pathway !== pathway) return false
      return true
    })
  }, [enrollments, term, pathway])

  const resetFilters = () => { setTerm(''); setPathway('') }
  const filtersActive = Boolean(term || pathway)
  const submittedCount = enrollments.filter((row) => row.documents?.length).length

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">LEARNER RECORDS</p><h1>Enrollment Documents</h1><p>Every submitted admission form and signed agreement, in one place. Each view is recorded in the audit log.</p></div>
    </div>
    <div className="stat-grid">
      <StatCard icon={FileText} label="Total enrollments" value={String(enrollments.length).padStart(2, '0')} detail="All pathways" trend="Records" />
      <StatCard icon={FileText} label="Documents on file" value={String(submittedCount).padStart(2, '0')} detail={`${enrollments.length - submittedCount} not yet submitted`} trend="Coverage" gold />
    </div>
    <div className="submissions-filters">
      <div className="roster-search"><Search size={17} /><input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search by name or email" aria-label="Search enrollments" /></div>
      <label className="roster-filter"><Filter size={13} /><select value={pathway} onChange={(event) => setPathway(event.target.value)} aria-label="Filter by pathway">
        <option value="">All pathways</option>
        {Object.entries(pathwayLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {filtersActive && <button type="button" className="button button-ghost button-compact" onClick={resetFilters}><X size={13} /> Clear</button>}
    </div>
    {error && <p className="form-alert" role="alert">{error.message}</p>}
    <div className="admin-table admin-table-documents">
      <div className="admin-table-head"><span>APPLICANT</span><span>PATHWAY</span><span>STATUS</span><span>SUBMITTED</span><span>DOCUMENTS</span></div>
      {isLoading ? <Loading label="Loading enrollment documents…" />
        : !filtered.length ? <p className="operations-note">{filtersActive ? 'No enrollments match those filters.' : 'No enrollments yet.'}</p>
        : filtered.map((row) => <div className="admin-table-row" key={rowId(row)}>
          <span><strong>{row.applicant?.name}</strong><small>{row.applicant?.email}</small></span>
          <span>{pathwayLabel[row.applicant?.pathway] ?? row.applicant?.pathway}</span>
          <span><StatusPill kind={pillKind(row.status)}>{statusLabel[row.status] ?? row.status}</StatusPill></span>
          <span>{formatDate(row.createdAt)}</span>
          <span><EnrollmentDocumentLinks enrollmentId={rowId(row)} applicantName={row.applicant?.name} documents={row.documents} /></span>
        </div>)}
    </div>
  </>
}
