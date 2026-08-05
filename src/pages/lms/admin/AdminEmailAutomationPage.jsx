import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Mail, Save, Send } from 'lucide-react'
import StatusPill from '../../../components/StatusPill.jsx'
import { useToast } from '../../../lib/toastContext.js'
import { fetchEmailTemplates, sendTestEmail, updateEmailTemplate } from '../../../lib/admin.js'
import Loading from '../../../components/Loading.jsx'

// `summary` is the one-glance line on a collapsed row; `trigger` is the full explanation, which
// only earns its space once the template is actually open.
const templateMeta = {
  enrollment_received: {
    label: 'Enrollment received',
    summary: 'When an application is started',
    trigger: 'Sent immediately when someone starts an enrollment application.',
    placeholders: ['{{name}}', '{{pathway}}', '{{enrollUrl}}'],
  },
  webinar_registration: {
    label: 'Webinar registration',
    summary: 'When someone registers for a webinar',
    trigger: 'Sent immediately when someone registers for a special course or webinar.',
    placeholders: ['{{name}}', '{{webinarTitle}}', '{{webinarDate}}'],
  },
  enrollment_credentials: {
    label: 'Welcome & account setup',
    summary: 'When a payment is confirmed, or staff create a user',
    trigger: 'Sent the moment a payment is confirmed (the account is created automatically), and whenever staff create or import a user directly. {{setupUrl}} is a one-time link for the learner to choose their own password — afterward they land on the sign-in page to use it.',
    placeholders: ['{{name}}', '{{email}}', '{{pathway}}', '{{setupUrl}}', '{{loginUrl}}'],
  },
  payment_receipt: {
    label: 'Payment receipt',
    summary: 'When a payment is confirmed',
    trigger: 'Sent right alongside the welcome email whenever a payment is confirmed — covers both "pay in full" and "pay upfront only" plans.',
    placeholders: ['{{name}}', '{{email}}', '{{pathway}}', '{{planLabel}}', '{{amountPaid}}', '{{totalAmount}}', '{{balanceDue}}', '{{referenceNumber}}', '{{transactionId}}', '{{paidAt}}', '{{loginUrl}}'],
    // Only meaningful inside the {{#hasDiscount}} section, so they're listed apart from the
    // always-available placeholders above rather than mixed in with them.
    sectionNote: 'Anything between {{#hasDiscount}} and {{/hasDiscount}} appears only when the enrollment used a voucher — that keeps an ordinary receipt free of an empty discount row. Inside it you can also use:',
    sectionPlaceholders: ['{{voucherCode}}', '{{discountLabel}}', '{{discountAmount}}', '{{discountBaseLabel}}', '{{discountBaseAmount}}', '{{discountScopeNote}}'],
  },
  newsletter_confirmation: {
    label: 'Newsletter signup',
    summary: 'When someone joins the newsletter',
    trigger: 'Sent immediately when someone submits the public newsletter form.',
    placeholders: ['{{email}}'],
  },
  password_reset: {
    label: 'Password reset',
    summary: 'When someone uses "Forgot password?"',
    trigger: 'Sent when someone uses "Forgot password?" on the sign-in page. {{resetUrl}} is a one-time link, valid 72 hours, that lets them choose a new password — this is the only way an existing learner can get back in, since the enrollment flow only issues a setup link for brand-new accounts.',
    placeholders: ['{{name}}', '{{email}}', '{{resetUrl}}', '{{loginUrl}}'],
  },
}

function TemplateRow({ template, open, onToggle }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const meta = templateMeta[template.key]
  const saved = { subject: template.subject, body: template.body, fromName: template.fromName ?? '', fromEmail: template.fromEmail ?? '', enabled: template.enabled }
  const [values, setValues] = useState(saved)
  const [testTo, setTestTo] = useState('')
  const dirty = Object.keys(saved).some((field) => values[field] !== saved[field])
  const set = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.value }))

  const saveMutation = useMutation({
    mutationFn: () => updateEmailTemplate(template.key, values),
    onSuccess: () => { toast.success('Template saved.'); queryClient.invalidateQueries({ queryKey: ['admin-email-templates'] }) },
    onError: (error) => toast.error(error.message),
  })
  const testMutation = useMutation({
    mutationFn: () => sendTestEmail(template.key, testTo.trim()),
    onSuccess: (result) => toast.success(`Test email sent to ${result.to}.`),
    onError: (error) => toast.error(error.message),
  })

  const panelId = `email-panel-${template.key}`
  return <article className={`admin-email-template ${open ? 'is-open' : ''}`}>
    {/* The whole header is the toggle, so the hit target is comfortable on a phone rather than a
        chevron you have to aim at. */}
    <button type="button" className="admin-email-template-toggle" onClick={onToggle} aria-expanded={open} aria-controls={panelId}>
      <ChevronRight className="admin-email-chevron" size={16} aria-hidden="true" />
      <span className="admin-email-template-title"><strong>{meta.label}</strong><small>{meta.summary}</small></span>
      <span className="admin-email-template-flags">
        {/* Surfaced on the collapsed row too — otherwise edits left in a closed panel are invisible. */}
        {dirty && <StatusPill kind="gold">Unsaved</StatusPill>}
        <StatusPill kind={values.enabled ? 'green' : 'red'}>{values.enabled ? 'On' : 'Off'}</StatusPill>
      </span>
    </button>

    {/* Hidden rather than unmounted, so switching between templates never discards typed edits. */}
    <div className="admin-email-template-panel" id={panelId} hidden={!open}>
      <p className="admin-email-trigger">{meta.trigger}</p>
      <label className="builder-publish-check"><input type="checkbox" checked={values.enabled} onChange={(event) => setValues((current) => ({ ...current, enabled: event.target.checked }))} /> Automatic sending enabled</label>
      <div className="admin-email-from-row">
        <label className="builder-field"><span>From name (optional)</span><input placeholder="Tree Academy" value={values.fromName} onChange={set('fromName')} /></label>
        <label className="builder-field"><span>From email (optional — falls back to the default sender)</span><input type="email" placeholder="hello@treeacademy.net" value={values.fromEmail} onChange={set('fromEmail')} /></label>
      </div>
      <label className="builder-field"><span>Subject</span><input value={values.subject} onChange={set('subject')} /></label>
      <label className="builder-field"><span>Body (HTML)</span><textarea value={values.body} onChange={set('body')} /></label>
      <div className="admin-email-placeholders">Placeholders: {meta.placeholders.map((placeholder) => <code key={placeholder}>{placeholder}</code>)}</div>
      {meta.sectionNote && <div className="admin-email-placeholders admin-email-section-note">
        <span>{meta.sectionNote}</span>
        {meta.sectionPlaceholders.map((placeholder) => <code key={placeholder}>{placeholder}</code>)}
      </div>}

      <div className="admin-email-actions">
        <button className="button button-primary button-compact" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !dirty}>
          <Save size={14} /> {saveMutation.isPending ? 'Saving…' : dirty ? 'Save template' : 'Saved'}
        </button>
        <div className="admin-email-test">
          <label className="builder-field">
            <span>Send a test to</span>
            <input type="email" placeholder="Your own address" value={testTo} onChange={(event) => setTestTo(event.target.value)} />
          </label>
          <button className="button button-ghost button-compact" onClick={() => testMutation.mutate()} disabled={testMutation.isPending}>
            <Send size={14} /> {testMutation.isPending ? 'Sending…' : 'Send test'}
          </button>
        </div>
      </div>
      <p className="admin-email-test-note">
        A test uses sample data and is subject-prefixed <code>[Test]</code>. Leave the address blank to send it to yourself. It works even while automatic sending is off — but it sends the <strong>saved</strong> template
        {dirty ? <strong> and you have unsaved changes above, so save first to test what you just wrote.</strong> : '.'}
      </p>
    </div>
  </article>
}

export default function AdminEmailAutomationPage() {
  const { data: templates = [], isLoading } = useQuery({ queryKey: ['admin-email-templates'], queryFn: fetchEmailTemplates })
  // One open at a time: these panels are tall (a full HTML body each), so letting several stand
  // open just rebuilds the wall of forms this replaced.
  const [openKey, setOpenKey] = useState('')

  return <>
    <div className="page-title-row"><div><p className="eyebrow">PLATFORM ADMIN</p><h1>Email automation</h1><p>Customize the automatic emails sent the moment someone enrolls or registers. Open a template to edit it, or send yourself a test to see how it looks.</p></div></div>
    {isLoading ? <Loading label="Loading templates…" />
      : !templates.length ? <p className="operations-note"><Mail size={17} /> No templates configured.</p>
      : <div className="admin-email-template-list">
        {templates.map((template) => <TemplateRow
          key={template.key}
          template={template}
          open={openKey === template.key}
          onToggle={() => setOpenKey((current) => (current === template.key ? '' : template.key))}
        />)}
      </div>}
  </>
}
