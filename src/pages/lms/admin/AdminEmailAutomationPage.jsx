import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, Save } from 'lucide-react'
import { useToast } from '../../../lib/toastContext.js'
import { fetchEmailTemplates, updateEmailTemplate } from '../../../lib/admin.js'
import Loading from '../../../components/Loading.jsx'

const templateMeta = {
  enrollment_received: {
    label: 'Enrollment received',
    trigger: 'Sent immediately when someone starts an enrollment application.',
    placeholders: ['{{name}}', '{{pathway}}', '{{enrollUrl}}'],
  },
  webinar_registration: {
    label: 'Webinar registration',
    trigger: 'Sent immediately when someone registers for a special course or webinar.',
    placeholders: ['{{name}}', '{{webinarTitle}}', '{{webinarDate}}'],
  },
  enrollment_credentials: {
    label: 'Welcome & account setup',
    trigger: 'Sent the moment a payment is confirmed (the account is created automatically), and whenever staff create or import a user directly. {{setupUrl}} is a one-time link for the learner to choose their own password — afterward they land on the sign-in page to use it.',
    placeholders: ['{{name}}', '{{email}}', '{{pathway}}', '{{setupUrl}}', '{{loginUrl}}'],
  },
  payment_receipt: {
    label: 'Payment receipt',
    trigger: 'Sent right alongside the welcome email whenever a payment is confirmed — covers both "pay in full" and "pay upfront only" plans.',
    placeholders: ['{{name}}', '{{email}}', '{{pathway}}', '{{planLabel}}', '{{amountPaid}}', '{{totalAmount}}', '{{balanceDue}}', '{{referenceNumber}}', '{{transactionId}}', '{{paidAt}}', '{{loginUrl}}'],
  },
  newsletter_confirmation: {
    label: 'Newsletter signup',
    trigger: 'Sent immediately when someone submits the public newsletter form.',
    placeholders: ['{{email}}'],
  },
  password_reset: {
    label: 'Password reset',
    trigger: 'Sent when someone uses "Forgot password?" on the sign-in page. {{resetUrl}} is a one-time link, valid 72 hours, that lets them choose a new password — this is the only way an existing learner can get back in, since the enrollment flow only issues a setup link for brand-new accounts.',
    placeholders: ['{{name}}', '{{email}}', '{{resetUrl}}', '{{loginUrl}}'],
  },
}

function TemplateCard({ template }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [values, setValues] = useState({ subject: template.subject, body: template.body, fromName: template.fromName ?? '', fromEmail: template.fromEmail ?? '', enabled: template.enabled })
  const meta = templateMeta[template.key]
  const mutation = useMutation({
    mutationFn: () => updateEmailTemplate(template.key, values),
    onSuccess: () => { toast.success('Template saved.'); queryClient.invalidateQueries({ queryKey: ['admin-email-templates'] }) },
    onError: (error) => toast.error(error.message),
  })

  return <article className="admin-email-template">
    <div className="admin-email-template-head">
      <div><h3>{meta.label}</h3><small>{meta.trigger}</small></div>
      <label className="builder-publish-check"><input type="checkbox" checked={values.enabled} onChange={(e) => setValues((v) => ({ ...v, enabled: e.target.checked }))} /> Automatic sending enabled</label>
    </div>
    <div className="admin-email-from-row">
      <label className="builder-field"><span>From name (optional)</span><input placeholder="Tree Academy" value={values.fromName} onChange={(e) => setValues((v) => ({ ...v, fromName: e.target.value }))} /></label>
      <label className="builder-field"><span>From email (optional — falls back to the default sender)</span><input type="email" placeholder="hello@treeacademy.net" value={values.fromEmail} onChange={(e) => setValues((v) => ({ ...v, fromEmail: e.target.value }))} /></label>
    </div>
    <label className="builder-field"><span>Subject</span><input value={values.subject} onChange={(e) => setValues((v) => ({ ...v, subject: e.target.value }))} /></label>
    <label className="builder-field"><span>Body (HTML)</span><textarea value={values.body} onChange={(e) => setValues((v) => ({ ...v, body: e.target.value }))} /></label>
    <div className="admin-email-placeholders">Placeholders: {meta.placeholders.map((p) => <code key={p}>{p}</code>)}</div>
    <div className="builder-lesson-actions">
      <button className="button button-primary button-compact" onClick={() => mutation.mutate()} disabled={mutation.isPending}><Save size={14} /> {mutation.isPending ? 'Saving…' : 'Save template'}</button>
    </div>
  </article>
}

export default function AdminEmailAutomationPage() {
  const { data: templates = [], isLoading } = useQuery({ queryKey: ['admin-email-templates'], queryFn: fetchEmailTemplates })

  return <>
    <div className="page-title-row"><div><p className="eyebrow">PLATFORM ADMIN</p><h1>Email automation</h1><p>Customize the automatic emails sent the moment someone enrolls or registers.</p></div></div>
    {isLoading ? <Loading label="Loading templates…" />
      : !templates.length ? <p className="operations-note"><Mail size={17} /> No templates configured.</p>
      : <div className="admin-email-template-list">{templates.map((template) => <TemplateCard template={template} key={template.key} />)}</div>}
  </>
}
