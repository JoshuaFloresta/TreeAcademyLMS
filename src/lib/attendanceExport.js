/**
 * Attendance Export Utilities for Tree Academy LMS
 * Generates RFC 4180 CSV strings with UTF-8 BOM (\uFEFF) for native Excel/Google Sheets compatibility,
 * as well as TSV for direct clipboard paste into spreadsheets.
 */

const formatStatusText = (status) => {
  switch (status) {
    case 'present': return 'Present'
    case 'late': return 'Late'
    case 'excused': return 'Excused'
    case 'absent': return 'Absent'
    default: return 'Unmarked'
  }
}

const escapeCsvCell = (value) => {
  if (value === null || value === undefined) return '""'
  const str = String(value)
  return `"${str.replace(/"/g, '""')}"`
}

const escapeTsvCell = (value) => {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[\t\r\n]/g, ' ')
}

const triggerDownload = (content, filename, mimeType = 'text/csv;charset=utf-8;') => {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Exports a single session's roll call to an Excel-compatible CSV file.
 */
export function exportSessionToCsv({ courseTitle, session, roster }) {
  const dateStr = session.startsAt ? new Date(session.startsAt).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : ''
  const timeStr = session.startsAt ? new Date(session.startsAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : ''

  const presentCount = roster.filter((r) => r.status === 'present').length
  const lateCount = roster.filter((r) => r.status === 'late').length
  const excusedCount = roster.filter((r) => r.status === 'excused').length
  const absentCount = roster.filter((r) => r.status === 'absent').length
  const unmarkedCount = roster.filter((r) => !r.status).length
  const totalCount = roster.length
  const rate = totalCount > 0 ? Math.round(((presentCount + lateCount) / totalCount) * 100) : 0

  const lines = [
    // UTF-8 BOM
    '\uFEFF' + [escapeCsvCell('TREE ACADEMY LMS - ATTENDANCE ROLL CALL')].join(','),
    [escapeCsvCell('Program / Course'), escapeCsvCell(courseTitle || 'All Programs')].join(','),
    [escapeCsvCell('Session Title'), escapeCsvCell(session.title || 'Session')].join(','),
    [escapeCsvCell('Session Date & Time'), escapeCsvCell(`${dateStr} at ${timeStr}`)].join(','),
    [escapeCsvCell('Session Type'), escapeCsvCell(session.eventType === 'office_hours' ? 'Office Hours' : 'Live Review')].join(','),
    [escapeCsvCell('Exported On'), escapeCsvCell(new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }))].join(','),
    '',
    [escapeCsvCell('Total Enrolled'), escapeCsvCell(totalCount), escapeCsvCell('Attendance Rate'), escapeCsvCell(`${rate}%`)].join(','),
    [escapeCsvCell('Present'), escapeCsvCell(presentCount), escapeCsvCell('Late'), escapeCsvCell(lateCount), escapeCsvCell('Excused'), escapeCsvCell(excusedCount), escapeCsvCell('Absent'), escapeCsvCell(absentCount), escapeCsvCell('Unmarked'), escapeCsvCell(unmarkedCount)].join(','),
    '',
    // Table Headers
    [
      escapeCsvCell('No.'),
      escapeCsvCell('Student Name'),
      escapeCsvCell('Email Address'),
      escapeCsvCell('Attendance Status'),
      escapeCsvCell('Remarks / Notes'),
      escapeCsvCell('Marked Time'),
    ].join(','),
  ]

  roster.forEach((student, index) => {
    const markedTimeStr = student.markedAt ? new Date(student.markedAt).toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'short' }) : '—'
    lines.push([
      escapeCsvCell(index + 1),
      escapeCsvCell(student.name || 'Unnamed'),
      escapeCsvCell(student.email || '—'),
      escapeCsvCell(formatStatusText(student.status)),
      escapeCsvCell(student.remarks || ''),
      escapeCsvCell(markedTimeStr),
    ].join(','))
  })

  const safeCourse = (courseTitle || 'program').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const safeSession = (session.title || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const safeDate = session.startsAt ? new Date(session.startsAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
  const filename = `attendance-${safeCourse}-${safeSession}-${safeDate}.csv`

  triggerDownload(lines.join('\r\n'), filename)
}

/**
 * Exports the entire program's attendance matrix (all sessions x all students) to an Excel-compatible CSV.
 */
export function exportMasterMatrixToCsv({ courseTitle, summary }) {
  const { sessions = [], learners = [], analytics = {} } = summary
  const generatedOn = new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })

  const lines = [
    '\uFEFF' + [escapeCsvCell('TREE ACADEMY LMS - MASTER ATTENDANCE REPORT')].join(','),
    [escapeCsvCell('Program / Course'), escapeCsvCell(courseTitle || 'Program')].join(','),
    [escapeCsvCell('Generated Date'), escapeCsvCell(generatedOn)].join(','),
    [escapeCsvCell('Total Sessions Conducted'), escapeCsvCell(analytics.totalSessions ?? sessions.length)].join(','),
    [escapeCsvCell('Total Enrolled Students'), escapeCsvCell(analytics.totalLearners ?? learners.length)].join(','),
    [escapeCsvCell('Overall Program Attendance Rate'), escapeCsvCell(`${analytics.overallAttendanceRate ?? 0}%`)].join(','),
    '',
  ]

  // Header row
  const headers = [
    escapeCsvCell('No.'),
    escapeCsvCell('Student Name'),
    escapeCsvCell('Email Address'),
  ]

  // Add a column header for each session
  sessions.forEach((s) => {
    const sDate = s.startsAt ? new Date(s.startsAt).toLocaleDateString('en-PH', { month: 'numeric', day: 'numeric' }) : ''
    headers.push(escapeCsvCell(`${s.title || 'Session'} (${sDate})`))
  })

  // Cumulative columns
  headers.push(
    escapeCsvCell('Total Present'),
    escapeCsvCell('Total Late'),
    escapeCsvCell('Total Excused'),
    escapeCsvCell('Total Absent'),
    escapeCsvCell('Unmarked'),
    escapeCsvCell('Attendance Rate'),
    escapeCsvCell('Standing'),
  )

  lines.push(headers.join(','))

  // Rows for each student
  learners.forEach((learner, index) => {
    const row = [
      escapeCsvCell(index + 1),
      escapeCsvCell(learner.name || 'Unnamed'),
      escapeCsvCell(learner.email || '—'),
    ]

    sessions.forEach((s) => {
      const rec = learner.records?.[s.id]
      if (!rec) {
        row.push(escapeCsvCell('—'))
      } else {
        const statusLetter = rec.status === 'present' ? 'P' : rec.status === 'late' ? 'L' : rec.status === 'excused' ? 'E' : 'A'
        const remarkSuffix = rec.remarks ? ` (${rec.remarks})` : ''
        row.push(escapeCsvCell(`${statusLetter}${remarkSuffix}`))
      }
    })

    const standingText = learner.stats.standing === 'good' ? 'Good Standing' : learner.stats.standing === 'warning' ? 'Needs Attention' : 'Critical / At-Risk'

    row.push(
      escapeCsvCell(learner.stats.present ?? 0),
      escapeCsvCell(learner.stats.late ?? 0),
      escapeCsvCell(learner.stats.excused ?? 0),
      escapeCsvCell(learner.stats.absent ?? 0),
      escapeCsvCell(learner.stats.unmarked ?? 0),
      escapeCsvCell(`${learner.stats.attendanceRate ?? 0}%`),
      escapeCsvCell(standingText),
    )

    lines.push(row.join(','))
  })

  // Summary footer row for session attendance rates
  const footerRow = [
    escapeCsvCell('—'),
    escapeCsvCell('SESSION ATTENDANCE RATE'),
    escapeCsvCell('—'),
  ]

  sessions.forEach((s) => {
    footerRow.push(escapeCsvCell(s.attendanceRate !== null ? `${s.attendanceRate}%` : 'Pending'))
  })

  footerRow.push(
    escapeCsvCell('—'),
    escapeCsvCell('—'),
    escapeCsvCell('—'),
    escapeCsvCell('—'),
    escapeCsvCell('—'),
    escapeCsvCell(`${analytics.overallAttendanceRate ?? 0}%`),
    escapeCsvCell('—'),
  )
  lines.push(footerRow.join(','))

  const safeCourse = (courseTitle || 'program').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const safeDate = new Date().toISOString().slice(0, 10)
  const filename = `master-attendance-${safeCourse}-${safeDate}.csv`

  triggerDownload(lines.join('\r\n'), filename)
}

/**
 * Copies the active session roster to the system clipboard in Tab-Separated Value (TSV) format
 * for instant pasting directly into Google Sheets or Microsoft Excel.
 */
export async function copySessionRosterToClipboard({ courseTitle, session, roster }) {
  const header = ['No.', 'Student Name', 'Email Address', 'Status', 'Remarks', 'Marked Time'].map(escapeTsvCell).join('\t')
  const rows = roster.map((student, index) => [
    escapeTsvCell(index + 1),
    escapeTsvCell(student.name || 'Unnamed'),
    escapeTsvCell(student.email || '—'),
    escapeTsvCell(formatStatusText(student.status)),
    escapeTsvCell(student.remarks || ''),
    escapeTsvCell(student.markedAt ? new Date(student.markedAt).toLocaleString('en-PH') : '—'),
  ].join('\t'))

  const text = `${courseTitle || ''} - ${session.title || 'Session'}\n${header}\n${rows.join('\n')}`
  await navigator.clipboard.writeText(text)
}

