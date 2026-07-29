# Tree Academy LMS Blueprint

## Product purpose

Tree Academy is an all-access review academy for real-estate brokers, consultants, and agents. It combines a public enrollment experience with an invite-only learning-management system (LMS).

The one-time all-access enrollment flow is:

`Choose pathway → complete agreement → complete PayMongo payment → staff approval → account-setup email → LMS`

The three public pathways are audience-specific entry points into the same all-access product:

- Broker Review
- Consultant Review
- Agent Review

## Design system

| Token | Value | Use |
| --- | --- | --- |
| Forest | `#1B432E` | Navigation, hero cards, primary actions, shadows, active/success states |
| Gold | `#B39255` | Dates, pending/urgent states, selected accents, subtitles |
| Cream | `#F9F9F7` | Application canvas and default panels |
| Ink | `#18181B` | Default body copy |

Use white or cream text on forest and gold surfaces. The visual language is editorial, confident, warm, and spacious, with a serif accent for italic headings and hard forest-green shadows on primary actions.

## Repository architecture

```text
treeacademyLMS/
├── src/                 # React/Vite client
│   ├── App.jsx          # Public pages, auth surfaces, LMS views
│   ├── App.css          # Design system and responsive layouts
│   └── main.jsx         # Router and React Query setup
├── server/              # Express/Mongoose API
│   ├── index.js         # HTTP, Socket.IO, REST routes, provider webhooks
│   ├── models.js        # MongoDB schemas
│   ├── security.js      # JWT, token hashing, role middleware, HMAC checks
│   ├── email.js         # Resend transactional-email adapter
│   ├── catalog.js       # All-access product and pathway data
│   └── config.js        # Environment-based configuration
├── .env.example         # Required integration variables
└── PLAN.md              # This blueprint
```

## Application areas

### Public website

- Landing page with hero, pathway cards, all-access pricing, FAQ, newsletter double opt-in, and contact footer.
- `/enroll` is a three-stage interface: applicant details, agreement consent/DocuSign recipient view, then PayMongo checkout.
- `/auth` supports sign in, invitation-aware account setup, forgot-password messaging, Google sign-in entry, and enrollment-pending state.

### LMS

- Protected desktop shell: forest left sidebar, content area, and online-member rail.
- Mobile shell: collapsible left sidebar and slide-out online-member panel.
- Learner navigation: Dashboard, Modules Catalog, Assignments, Calendar, Notifications, Settings, Profile.
- Instructor/admin navigation additionally exposes Academy Operations for enrollment approval, refunding, pricing, and course management.
- Starter content is editable Broker, Consultant, and Agent course shells with modules, lessons, assignments, quizzes, events, announcements, and progress.

## Roles and authorization

| Capability | Learner | Instructor | Admin |
| --- | --- | --- | --- |
| View own learning/work | Yes | Yes | Yes |
| Submit work / view own grades | Yes | Yes | Yes |
| Publish content / grade learners | No | Yes | Yes |
| Review enrollments / initiate refunds | No | Yes | Yes |
| Manage programs and pricing | No | Yes | Yes |
| Manage users, roles, integrations, audit logs | No | No | Yes |

All protected API routes must validate a short-lived access token and enforce the role server-side. Never depend on hidden client navigation for authorization.

## Data model

Core MongoDB collections are defined in `server/models.js`:

- `User`, `RefreshToken`, `Presence`, `AuditLog`
- `Program`, `Course`, `Module`, `Lesson`, `Assignment`, `Submission`, `Quiz`
- `Enrollment`, `CalendarEvent`, `Notification`
- `NewsletterSubscriber`, `WebhookEvent`

Files are never stored directly in MongoDB. Store only private object keys for signed PDFs and course files, then issue short-lived download URLs after authorization.

## Enrollment and provider contracts

The only permitted enrollment transitions are:

```text
contract_pending
  → contract_signed
  → payment_pending
  → paid_approval_pending
  → approved | rejected | refunded
```

- DocuSign: create an envelope from an approved template, use an embedded recipient view, verify completion notifications, retrieve the completed PDF, and record the envelope ID/audit metadata.
- PayMongo: create checkout server-side with the enrollment ID in trusted metadata. Treat the browser return URL as presentation only; move to paid state only after a signature-verified webhook. Persist provider event IDs to make retries idempotent.
- Approval: when a staff member approves a paid enrollment, create or reuse the email-matched learner identity, generate a 72-hour setup token, hash it at rest, and send it using the configured email adapter.
- Rejection/refund: record the staff reason and audit action. A PayMongo refund must be created by the server and its webhook must set the final `refunded` status.

The current development interface deliberately does not fabricate live contracts or payments. The API exposes development-only transition routes when `DEMO_MODE=true`; production must have real provider credentials and signed webhook verification.

## Authentication and security

- Passwords use bcrypt hashing; account setup requires a one-time, expiry-bound invitation token.
- Access tokens expire quickly. Refresh tokens are random, hashed in MongoDB, stored in `httpOnly` cookies, and rotated on refresh.
- Google OAuth is enabled only after Google client configuration is supplied. The callback must accept only an approved/invited email and bind the provider subject to that user.
- Enable `secure` cookies and HTTPS in production. Keep CORS restricted to `CLIENT_URL`.
- Apply rate limiting to public API endpoints. Validate all input with Zod. Use Helmet, upload size/type allowlists, signed storage URLs, and audit events for approvals, refunds, login-sensitive actions, and document access.
- Do not expose provider secrets, raw webhook payloads containing PII, signed PDF URLs, or invitation tokens in logs or client responses.

## Local development

1. Copy `.env.example` to `.env` and set at least `JWT_SECRET` and `MONGODB_URI` for persistent API work.
2. Run `npm install`.
3. Start the client with `npm run dev` and API with `npm run dev:api`, or run both with `npm run dev:all`.
4. Use the visual demo without MongoDB only for interface review; it uses in-memory records and must never be used as a production environment.
5. Validate with `npm run lint` and `npm run build` before merging.

### Development page navigator

Vite development builds render a fixed **Dev pages** navigator. It provides a role switcher and a compact, role-filtered page dropdown. It discovers LMS page files from `src/pages/lms` automatically, is gated by `import.meta.env.DEV`, and is omitted from production builds.

## Required production configuration

- MongoDB Atlas connection string and database user
- `JWT_SECRET`, allowed frontend URL, and HTTPS deployment
- DocuSign integration key, account, template, OAuth/service authorization, and webhook secret
- PayMongo production secret key and webhook secret; configured checkout payment methods
- Resend API key and verified sender domain
- Google OAuth client credentials and authorized redirect URI
- Private S3-compatible bucket with server credentials and lifecycle policy

## Implementation milestones

1. **Foundation** — completed: public UI, responsive LMS shell, data schemas, API boundaries, demo-safe enrollment states, catalog, newsletter endpoint, presence channel, build/lint setup.
2. **Authentication** — finish verified account setup, password reset, Google OAuth callback, protected React route/session state, and role-aware API client.
3. **Provider adapters** — implement DocuSign envelope/recipient -view/download operations and PayMongo checkout/refund operations with sandbox tests and exact signature validation from current provider documentation.
4. **Learning features** — replace preview data with CRUD interfaces for course authoring, lessons, submissions, grading, notifications, calendar events, and file uploads.
5. **Operations** — connect approval/refund controls, transactional email retries, audit-log viewer, user/role management, and program pricing management.
6. **Quality and release** — add Vitest, Supertest, and Playwright coverage; accessibility review; error monitoring; database backups; staging provider webhooks; production deployment.

## Acceptance checklist

- A learner cannot access course content before a staff-approved enrollment.
- A browser redirect alone cannot mark any payment paid.
- Duplicate or retried webhooks do not repeat enrollment, payment, refund, or invitation effects.
- A staff approval creates exactly one email-keyed learner identity and a single active invitation.
- The landing page, enrollment flow, login, and LMS work at mobile, tablet, and desktop widths.
- Learners can see only their own work; staff-only operations fail server-side for learners.
- Signed agreements and uploaded learning files are inaccessible without authorized, expiring URLs.
