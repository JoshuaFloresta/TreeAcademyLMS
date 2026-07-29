# CLAUDE.md

Guidance for working in this repository. For product intent and the full blueprint, read
[PLAN.md](PLAN.md) — this file is the operational quick-reference and does not repeat it.

## What this is

Tree Academy is a review academy for real-estate brokers, consultants, and agents, pairing a
public enrollment flow with an invite-only LMS. There are three pathways (`broker`, `consultant`,
`agent`), each mapped to its own course (slug `${pathway}-review`). **A learner only sees the
course tied to the pathway on their approved enrollment** — access is granted automatically at
approval time via a `LearningProgress` row (the enrollment/access join for that course), not by
role alone. A learner approved for a second pathway later gains that course too, without losing
the first. See `learnerVisibleCourseFilter`/`provisionLearnerAccount` in `server/index.js`.
Instructors/admins always see every course regardless of pathway.

Each course's modules are presented to learners as review **phases** (Phase 1: Foundations, Phase
2: Valuation Methods & Practice, etc.) — the `Module` model doubles as a phase, with an optional
`phaseNumber` an instructor can customize (falls back to list position). Each `Lesson` may carry a
`driveUrl` (an instructor-set external link, typically a Google Drive PDF) shown as an "Open PDF"
button next to that lesson wherever it renders.

## Stack

- **Client:** React 19 + Vite 8, React Router 7, React Query, `react-hook-form` + `zod` (used in
  newsletter/auth only — the enrollment steps use uncontrolled inputs + native validity), Tailwind 4,
  Framer Motion, `lucide-react` icons.
- **Server:** Express 5 + Mongoose 9 + Socket.IO (presence). ESM (`"type": "module"`).
- **PDF:** `pdf-lib` (server-side only) fills AcroForm templates and renders certificates — it remains
  the sole authority for generating the final flattened, signed PDF. `pdfjs-dist` (client-side,
  dynamically imported) renders the contract-signing step's PDF template to canvas and overlays real
  `<input>`/checkbox elements positioned from the template's own AcroForm field rects, so learners
  type directly into the document instead of a parallel HTML form; see
  `src/components/enrollment/InteractivePdfFields.jsx`.
- **Email:** Resend HTTP API. **Auth:** `jsonwebtoken` + `bcryptjs`.

## Commands

```bash
npm install
npm run dev          # client (Vite) on :5173
npm run dev:api      # API (node --watch) on :4000
npm run dev:all      # both (concurrently)
npm run seed:admin   # create/update the first admin user (see below)
npm run lint         # eslint
npm run build        # vite build
```

Always run `npm run lint` and `npm run build` before considering work done.

## Repository layout

```
src/
  App.jsx, main.jsx        # routes, providers
  pages/                   # LandingPage, EnrollmentPage, AuthPage, lms/*
  components/enrollment/   # ApplicationStep, DocumentStep, SignatureField, PaymentStep, EnrollmentAside
  lib/                     # api.js (API_URL), auth.js (session + authedFetch), academyData.js, schemas.js
server/
  index.js                 # HTTP, Socket.IO, REST routes, provider webhooks
  models.js                # 19 Mongoose schemas
  security.js              # JWT, token hashing, role middleware, HMAC / PayMongo signature
  email.js                 # Resend adapters
  enrollment-documents.js  # pdf-lib: fill+flatten agreement PDFs, embed signature
  certificates.js          # pdf-lib certificate rendering
  storage.js               # file storage: local disk in dev, S3-compatible bucket in production
  catalog.js               # single all-access product (amount 14900 PHP) + pathways
  config.js                # env-based config + isAllowedOrigin (shared CORS allow-list)
  templates/               # realex-reblex.pdf, reclex.pdf (AcroForm sources the server fills)
  private-storage/         # dev-only file storage root (never committed)
public/enrollment-documents/  # client-servable copies of the two PDFs (iframe preview + download)
```

## Enrollment state machine

```
application_pending → documents_pending → payment_pending → approved | rejected | refunded
```

Flow: applicant details → application PDF generated → sign the pathway agreement
(`consultant` → `reclex`, else `realex-reblex`) → PayMongo Checkout Session (learner picks "pay in
full" or "pay the pathway's upfront fee only" — see Pricing below) → signed webhook confirms
payment and **immediately** provisions the learner account (active, auto-generated temp password)
via `markEnrollmentPaid`/`provisionLearnerAccount` in `server/index.js` — there is no staff-review
gate in the primary path. The credentials email is the admin-customizable `enrollment_credentials`
template (Settings → Email Automation), rendered with `{{name}}`/`{{email}}`/`{{password}}`/
`{{loginUrl}}`. `paid_approval_pending` still exists in the schema and
`POST /api/staff/enrollments/:id/decision` still works, as a manual fallback for anomalies (e.g. a
payment-link enrollment that never got a webhook) — it is not part of the normal flow.

- `POST /api/enrollments` create; `/application` saves intake + summary PDF;
  `/documents/:type` fills+flattens the agreement and emails staff; `/payment-session` (accepts
  `{ plan: 'full' | 'upfront' }`) opens PayMongo checkout for the corresponding amount.
- `POST /api/webhooks/paymongo` — signature-verified, idempotent via `WebhookEvent`. On
  `checkout_session.payment.paid` it calls `markEnrollmentPaid`, which provisions the account. This
  only runs from inside the signature-verified handler — a browser redirect alone still never
  grants access on its own (see Security rules below).
- `GET /api/staff/enrollments` and `POST /api/staff/enrollments/:id/decision`
  (`{ decision: approved|rejected|refunded, reason? }`) — `requireAuth` + `requireStaff` — manual
  fallback path only now.

## Pricing

`PricingSettings` (singleton Mongo doc, admin-edited at `/admin/courses` — merged into the Course
Catalog page since a price only makes sense once its course exists) replaces the old hardcoded
`catalog.product.amount`. Both the full price and the upfront reservation fee are independently
editable per pathway: `totalBroker`/`totalConsultant`/`totalAgent` and `upfrontBroker`/
`upfrontConsultant`/`upfrontAgent` — six fields total, one pair per pathway. Broker and Agent are
priced independently even though they sign the same "realex-reblex" agreement document; that's a
document-generation detail (`enrollment-documents.js`), not a pricing one. `totalAmountForPathway`/
`upfrontAmountForPathway` in `server/index.js` resolve the right field for a given pathway.
`GET /api/pricing` is public (the enrollment flow isn't authenticated); falls back to `catalog.js`'s
static values if no settings row exists yet or Mongo is unavailable. An "upfront" plan only charges
the fee — `enrollment.amount` still holds the full price, and `enrollment.payment.plan`/
`payment.planAmount` record what was actually charged, so staff can see the outstanding balance
(surfaced in `AdminEnrollmentsPage`). Balance collection for upfront-plan enrollments is
manual/offline — there's no in-app "pay the rest" flow.

Only the 3 pathway courses (`broker-review`/`consultant-review`/`agent-review`, joined to
`PricingSettings` purely by slug convention) show price fields on their Course Catalog card — a
course created outside those 3 pathways has no price, since checkout is keyed off the enrollment
pathway, not an arbitrary course. `POST /api/staff/courses` (used by both admins and instructors)
creates a new course; the merged admin page exposes a "New course" card for this.

## Database: dual mode

Without `MONGODB_URI` the server runs an in-memory fallback (Maps) — data is lost on restart and
**auth/staff/LMS routes that need Mongo return 503**. Set `MONGODB_URI` for real work; production
requires it. `databaseReady` gates the two paths throughout `server/index.js`.

### First admin

Staff approval needs a staff user, and nothing self-registers as one. Create it with:

```bash
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='...' SEED_ADMIN_NAME='Admin' npm run seed:admin
```

### Backfilling pathway access for pre-existing learners

Pathway-gated catalog access (see above) shipped after learners could already be active. Run
`npm run migrate:backfill-access` once against a populated database — it grants each active
learner without a `LearningProgress` row access to the course matching their most recent approved
`Enrollment.applicant.pathway`, so no one loses access they already paid for.

## Security rules (do not regress)

- Enforce roles **server-side** on every protected route; never rely on hidden client nav.
- A browser redirect alone never marks a payment paid — only a signature-verified webhook does.
  (As of the auto-provisioning change above, that webhook is also the *only* place account
  creation is triggered from — the client's `/enroll?payment=success` return page never calls
  anything that grants access, it only reads state a verified webhook already wrote.)
- Keep webhook effects idempotent (`WebhookEvent` dedupe).
- Never log or return provider secrets, raw PII webhook payloads, signed-PDF URLs, or tokens.
- Files are not stored in Mongo — only storage keys (see `storage.js`). Private files are streamed
  through a route that authorizes the caller first (`sendPrivateDownload`); only the `public/`
  prefix (avatars, banners) is ever reachable by URL.
- CORS/Socket.IO origins go through `isAllowedOrigin` (`config.js`) — never widen it to a wildcard,
  since these requests carry credentials.

## File storage

`server/storage.js` is the only module that touches file bytes. It runs in two modes:
local disk (`server/private-storage/`) when no `S3_*` env vars are set, and an S3-compatible bucket
(Cloudflare R2, AWS S3, MinIO…) when they are. Development therefore needs no external service,
while production **requires** object storage — the server refuses to boot without it, because
managed hosts have ephemeral disks that would silently destroy signed agreements on every redeploy.

Use `putFile`/`getFile`/`randomKey`; never `fs` directly for user data. Keys are POSIX paths and
only the key is persisted in Mongo, so switching providers never invalidates existing rows.
`npm run migrate:storage` uploads existing local files into the configured bucket.

## Environment

Copy `.env.example` → `.env`. For a working end-to-end flow set at least: `MONGODB_URI`,
`JWT_SECRET`, `CLIENT_URL`, `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`, `RESEND_API_KEY`,
`EMAIL_FROM`. Adapters degrade gracefully (log instead of send) when their keys are absent.

## Deployment

Frontend on Vercel, API on Render, files on R2 — see [DEPLOYMENT.md](DEPLOYMENT.md). The API cannot
run on Vercel: Socket.IO presence needs a long-lived process. Because the two are on different
sites, auth cookies use `SameSite=None; Secure` in production (`cookieOptions` in `index.js`) and
`VITE_API_URL` is baked into the client at build time.

## Conventions

- Match the surrounding terse, single-line JSX style in components; keep comment density low.
- Reuse existing helpers: `createToken`/`hashToken`/`signAccessToken` (`security.js`),
  `saveAudit`/`findEnrollment`/`publicEnrollment` (`index.js`), `authedFetch` (`src/lib/auth.js`).
```
