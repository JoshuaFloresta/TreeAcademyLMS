// What a staff member is allowed to know about an enrollment's paperwork: which documents exist and
// when they were signed — never the storage keys. Keys are how the file is fetched, so handing them
// to the browser would turn a rendered list into a set of addresses for signed legal agreements.
// Downloads go through GET /api/staff/enrollments/:id/documents/:type, which re-checks the caller.
export const ENROLLMENT_DOCUMENT_TYPES = {
  application: { label: 'Admission form', key: (row) => row.intake?.pdfKey, signedAt: (row) => row.intake?.submittedAt },
  'realex-reblex': { label: 'REALEX / REBLEX agreement', key: (row) => row.documents?.realexReblex?.pdfKey, signedAt: (row) => row.documents?.realexReblex?.signedAt },
  reclex: { label: 'RECLEX agreement', key: (row) => row.documents?.reclex?.pdfKey, signedAt: (row) => row.documents?.reclex?.signedAt },
}
export const enrollmentDocuments = (row) => Object.entries(ENROLLMENT_DOCUMENT_TYPES)
  .filter(([, spec]) => spec.key(row))
  .map(([type, spec]) => ({ type, label: spec.label, signedAt: spec.signedAt(row) ?? null }))
