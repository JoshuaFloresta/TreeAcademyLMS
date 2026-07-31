import { config } from './config.js'
import { getFile } from './storage.js'
import { EmailTemplate } from './models.js'

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])

// Shared Tree Academy branding (header/accent-bar/content/footer) reused by every default HTML
// template below, so a design tweak here stays consistent across all of them. Only affects the
// seeded defaults — once an admin edits a template in Settings > Email Automation, their saved
// HTML is what's actually sent, independent of this shell.
const baseEmailStyle = `
        body, p, h1, h2, h3 {
            margin: 0;
            padding: 0;
        }
        body {
            background-color: #F9F9F7;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            color: #1B432E;
            -webkit-font-smoothing: antialiased;
            line-height: 1.6;
        }
        .container {
            max-width: 600px;
            margin: 40px auto;
            background-color: #ffffff;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
            border: 1px solid #EAEAEA;
        }
        .header {
            background-color: #1B432E;
            padding: 36px 20px;
            text-align: center;
        }
        .header h1 {
            color: #F9F9F7;
            font-size: 26px;
            font-weight: 700;
            letter-spacing: 2px;
            margin: 0;
        }
        .header p {
            color: #B39255;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            margin-top: 6px;
            font-weight: 600;
        }
        .accent-bar {
            height: 4px;
            background-color: #B39255;
            width: 100%;
        }
        .content {
            padding: 40px 32px;
        }
        .welcome-text {
            font-size: 18px;
            font-weight: 600;
            color: #1B432E;
            margin-bottom: 16px;
        }
        .body-text {
            font-size: 15px;
            color: #2D3748;
            margin-bottom: 24px;
        }
        .button-wrapper {
            text-align: center;
            margin: 36px 0 28px 0;
        }
        .btn {
            background-color: #1B432E;
            color: #F9F9F7 !important;
            padding: 14px 32px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            font-size: 15px;
            display: inline-block;
            border: 1px solid #1B432E;
            transition: background-color 0.2s ease;
        }
        .footer {
            background-color: #F9F9F7;
            padding: 24px 32px;
            text-align: center;
            border-top: 1px solid #EEEEEE;
        }
        .footer p {
            font-size: 13px;
            color: #718096;
            margin-bottom: 8px;
        }
        .footer a {
            color: #1B432E;
            text-decoration: underline;
        }`

function emailShell({ title, eyebrow, extraStyle = '', bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>${baseEmailStyle}
${extraStyle}
    </style>
</head>
<body>

    <div class="container">
        <div class="header">
            <h1>TREE ACADEMY</h1>
            <p>${eyebrow}</p>
        </div>

        <div class="accent-bar"></div>

        <div class="content">
${bodyHtml}
        </div>

        <div class="footer">
            <p>Need assistance? Contact our support team at <a href="mailto:support@treeacademy.net">support@treeacademy.net</a></p>
            <p>&copy; 2026 TREE Academy. All rights reserved.</p>
        </div>
    </div>

</body>
</html>`
}

// Admin-customizable templates for events like "someone enrolled" or "someone registered for a
// webinar" — separate from the fixed transactional emails above (account setup, credentials).
export const emailTemplateDefaults = {
  // Sent the moment someone starts an enrollment application (see POST /api/enrollments).
  enrollment_received: {
    subject: 'We received your Tree Academy application, {{name}}!',
    body: emailShell({
      title: 'Tree Academy Application Received',
      eyebrow: 'Application Received',
      bodyHtml: `            <p class="welcome-text">Thanks for starting your enrollment, {{name}}!</p>

            <p class="body-text">
                We’ve received the start of your enrollment for our <strong>{{pathway}}</strong> review pathway. Our team will review your application shortly.
            </p>

            <p class="body-text">
                You can pick up right where you left off any time using the link below.
            </p>

            <div class="button-wrapper">
                <a href="{{enrollUrl}}" class="btn">Continue My Enrollment</a>
            </div>

            <p class="body-text" style="font-size: 13px; color: #718096; text-align: center;">
                If the button above doesn't work, copy and paste <strong>{{enrollUrl}}</strong> into your web browser.
            </p>`,
    }),
  },
  webinar_registration: {
    subject: 'You’re registered: {{webinarTitle}}',
    body: '<p>Hello {{name}},</p><p>You’re confirmed for <strong>{{webinarTitle}}</strong> on {{webinarDate}}. We’ll send a reminder as the date approaches.</p><p>— Tree Academy</p>',
  },
  // Sent the moment someone submits the public newsletter form (see POST /api/newsletter). Single
  // opt-in — there is no separate confirm-by-clicking-a-link step today.
  newsletter_confirmation: {
    subject: 'You’re on the list, Tree Academy!',
    body: emailShell({
      title: 'Tree Academy Newsletter',
      eyebrow: 'Newsletter',
      bodyHtml: `            <p class="welcome-text">You're subscribed!</p>

            <p class="body-text">
                Thanks for signing up to hear from Tree Academy. We'll send review tips, cohort openings, and program updates to <strong>{{email}}</strong>.
            </p>`,
    }),
  },
  // Sent the moment an enrollment's payment is confirmed (see markEnrollmentPaid/provisionLearnerAccount
  // in index.js) and whenever staff create/import a user directly — {{setupUrl}} is a one-time link
  // (POST /api/auth/activate) for the learner to choose their own password, {{loginUrl}} is the plain
  // LMS sign-in page for the current environment.
  enrollment_credentials: {
    subject: 'WELCOME TO TREEACADEMY!',
    body: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to TREE Academy</title>
    <style>${baseEmailStyle}
        .credentials-box {
            background-color: #F9F9F7;
            border-left: 4px solid #B39255;
            padding: 20px;
            border-radius: 0 6px 6px 0;
            margin: 28px 0;
        }
        .credentials-title {
            font-size: 14px;
            font-weight: 700;
            color: #1B432E;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 12px;
        }
        .credential-item {
            font-size: 15px;
            color: #1B432E;
            margin-bottom: 8px;
        }
        .credential-item:last-child {
            margin-bottom: 0;
        }
        .credential-label {
            font-weight: 600;
            color: #555555;
            width: 90px;
            display: inline-block;
        }
    </style>
</head>
<body>

    <div class="container">
        <div class="header">
            <h1>TREE ACADEMY</h1>
            <p>Real Estate Review Center</p>
        </div>

        <div class="accent-bar"></div>

        <div class="content">
            <p class="welcome-text">We’ve received the start of your enrollment for the {{pathway}} review pathway!</p>

            <p class="body-text">
                To finish setting up your account and continue, please create a new password using your registered email address.
            </p>

            <div class="credentials-box">
                <div class="credentials-title">Your Access Details</div>
                <div class="credential-item">
                    <span class="credential-label">Portal:</span>
                    <a href="{{loginUrl}}" style="color: #1B432E; font-weight: 600;">treeacademy.net</a>
                </div>
                <div class="credential-item">
                    <span class="credential-label">Username:</span>
                    <strong>{{email}}</strong>
                </div>
            </div>

            <p class="body-text">
                Click below to create your password. This link is valid for 72 hours — afterward, sign in on the login page with your new password.
            </p>

            <div class="button-wrapper">
                <a href="{{setupUrl}}" class="btn">Create New Password</a>
            </div>

            <p class="body-text" style="font-size: 13px; color: #718096; text-align: center;">
                If the button above doesn't work, copy and paste <strong>{{setupUrl}}</strong> into your web browser.
            </p>
        </div>

        <div class="footer">
            <p>Need assistance? Contact our support team at <a href="mailto:support@treeacademy.net">support@treeacademy.net</a></p>
            <p>&copy; 2026 TREE Academy. All rights reserved.</p>
        </div>
    </div>

</body>
</html>`,
  },
  // Sent right alongside the credentials email whenever a payment is confirmed (see
  // sendPaymentReceiptEmail in index.js) — {{amountPaid}} is what was actually charged this time
  // (the full price, or just the upfront fee), {{totalAmount}}/{{balanceDue}} cover the "pay
  // upfront only" plan where a balance remains (balanceDue is "₱0" when nothing is owed).
  payment_receipt: {
    subject: 'Your Tree Academy payment receipt — {{referenceNumber}}',
    body: emailShell({
      title: 'Tree Academy Payment Receipt',
      eyebrow: 'Payment Receipt',
      extraStyle: `        .receipt-box {
            background-color: #F9F9F7;
            border-left: 4px solid #B39255;
            padding: 20px;
            border-radius: 0 6px 6px 0;
            margin: 28px 0;
        }
        .receipt-title {
            font-size: 14px;
            font-weight: 700;
            color: #1B432E;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 12px;
        }
        .receipt-table {
            width: 100%;
            border-collapse: collapse;
        }
        .receipt-table td {
            font-size: 15px;
            color: #1B432E;
            padding: 8px 0;
            border-bottom: 1px solid #EAEAEA;
            vertical-align: top;
        }
        .receipt-table tr:last-child td {
            border-bottom: 0;
        }
        .receipt-label-cell {
            font-weight: 600;
            color: #555555;
            white-space: nowrap;
            padding-right: 14px;
            width: 1%;
        }
        .receipt-value-cell {
            text-align: right;
            word-break: break-all;
        }
        .receipt-total td {
            color: #1B432E;
            font-weight: 800;
        }`,
      bodyHtml: `            <p class="welcome-text">Thank you for your payment, {{name}}!</p>

            <p class="body-text">
                This confirms we received your payment for the <strong>{{pathway}}</strong> enrollment. Keep this receipt for your records.
            </p>

            <div class="receipt-box">
                <div class="receipt-title">Receipt Details</div>
                <table class="receipt-table" role="presentation" cellpadding="0" cellspacing="0">
                    <tr><td class="receipt-label-cell">Reference No.</td><td class="receipt-value-cell">{{referenceNumber}}</td></tr>
                    <tr><td class="receipt-label-cell">Transaction ID</td><td class="receipt-value-cell">{{transactionId}}</td></tr>
                    <tr><td class="receipt-label-cell">Date paid</td><td class="receipt-value-cell">{{paidAt}}</td></tr>
                    <tr><td class="receipt-label-cell">Payment type</td><td class="receipt-value-cell">{{planLabel}}</td></tr>
                    <tr class="receipt-total"><td class="receipt-label-cell">Amount paid</td><td class="receipt-value-cell">{{amountPaid}}</td></tr>
                    <tr><td class="receipt-label-cell">Full enrollment price</td><td class="receipt-value-cell">{{totalAmount}}</td></tr>
                    <tr><td class="receipt-label-cell">Balance remaining</td><td class="receipt-value-cell">{{balanceDue}}</td></tr>
                </table>
            </div>

            <p class="body-text">
                Check your balance and payment details anytime by logging into your account.
            </p>

            <div class="button-wrapper">
                <a href="{{loginUrl}}" class="btn">Go to Your Account</a>
            </div>`,
    }),
  },
}

function renderTemplate(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in vars ? escapeHtml(vars[key]) : match))
}

// Resend's own rejection reason (e.g. "domain not verified", "restricted API key", "you can only
// send testing emails to your own address") is far more useful than the bare status code — without
// it, a failed send in the logs just says "(403)" and gives no clue which of several possible
// causes it actually is.
async function emailProviderError(label, response) {
  const body = await response.json().catch(() => ({}))
  return new Error(`Email provider rejected ${label} (${response.status}): ${body.message ?? 'no further details'}`)
}

export async function ensureDefaultEmailTemplates() {
  for (const [key, defaults] of Object.entries(emailTemplateDefaults)) {
    await EmailTemplate.findOneAndUpdate({ key }, { $setOnInsert: { key, ...defaults, enabled: true } }, { upsert: true, setDefaultsOnInsert: true })
  }
}

// Fires an admin-customizable template email for an enrollment/registration event. Best-effort —
// callers should not fail the triggering request if this rejects.
export async function sendTemplatedEmail(key, to, vars) {
  const template = await EmailTemplate.findOne({ key }).lean()
  if (!template || !template.enabled) return { delivery: 'disabled' }
  if (!config.email.resendApiKey || !config.email.from) {
    console.warn(`Templated email "${key}" for ${to} is queued but email is not configured.`)
    return { delivery: 'configuration_required' }
  }
  const from = template.fromEmail ? (template.fromName ? `${template.fromName} <${template.fromEmail}>` : template.fromEmail) : config.email.from
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.email.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: renderTemplate(template.subject, vars), html: renderTemplate(template.body, vars) }),
  })
  if (!response.ok) throw await emailProviderError(`templated email "${key}"`, response)
  return { delivery: 'sent' }
}

export async function sendAccountSetupEmail({ name, email, token }) {
  const setupUrl = `${config.clientUrl}/auth?mode=signup&token=${encodeURIComponent(token)}`
  if (!config.email.resendApiKey || !config.email.from) {
    console.warn(`Account invite for ${email} is queued but email is not configured. Setup URL: ${setupUrl}`)
    return { delivery: 'configuration_required' }
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.email.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: config.email.from,
      to: [email],
      subject: 'Set up your Tree Academy account',
      html: `<p>Hello ${name},</p><p>Your Tree Academy enrollment is approved. Set a password to enter your learning space:</p><p><a href="${setupUrl}">Set up my account</a></p><p>This link expires in 72 hours.</p>`,
    }),
  })
  if (!response.ok) throw await emailProviderError('account invite', response)
  return { delivery: 'sent' }
}

export async function sendEnrollmentDocumentsEmail({ enrollmentId, applicant, documentKeys }) {
  if (!config.email.resendApiKey || !config.email.from) {
    console.warn(`Enrollment documents for ${enrollmentId} are ready but email is not configured.`)
    return { delivery: 'configuration_required' }
  }

  const attachments = await Promise.all(documentKeys.map(async ({ key, filename }) => ({
    filename,
    content: (await getFile(key)).toString('base64'),
  })))
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.email.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: config.email.from,
      to: [config.email.enrollmentRecipient],
      subject: 'New Enrollee Registration',
      html: `<p>A new enrollee has completed the admission form and submitted the signed agreement.</p><p><strong>Name:</strong> ${escapeHtml(applicant.name)}</p><p><strong>Email:</strong> ${escapeHtml(applicant.email)}</p><p><strong>Enrollment ID:</strong> ${escapeHtml(enrollmentId)}</p><p>The application summary and signed PDF are attached.</p>`,
      attachments,
    }),
  })
  if (!response.ok) throw await emailProviderError('enrollment documents', response)
  return { delivery: 'sent' }
}
