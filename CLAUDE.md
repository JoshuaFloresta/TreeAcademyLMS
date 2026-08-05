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
the fee — `enrollment.amount` holds the full price (net of any voucher, see below), and
`enrollment.payment.plan`/
`payment.planAmount` record what was actually charged, so staff can see the outstanding balance
(surfaced in `AdminEnrollmentsPage`). Balance collection for upfront-plan enrollments is
manual/offline — there's no in-app "pay the rest" flow.

Only the 3 pathway courses (`broker-review`/`consultant-review`/`agent-review`, joined to
`PricingSettings` purely by slug convention) show price fields on their Course Catalog card — a
course created outside those 3 pathways has no price, since checkout is keyed off the enrollment
pathway, not an arbitrary course. `POST /api/staff/courses` (used by both admins and instructors)
creates a new course; the merged admin page exposes a "New course" card for this.

## Vouchers / discount codes

`Voucher` (admin-managed at `/admin/vouchers`) is a code an applicant types **on the payment step
only** — `VoucherField` renders solely inside `PaymentStep`, never on the admission form or the
agreement step. Fields: `code` (stored uppercase, unique), `discountType` (`percent` | `fixed`),
`discountValue`, `appliesTo` (`total` | `upfront`), `expiresAt` (null = never), `maxUses`
(0 = unlimited), `maxUsesPerApplicant` (0 = no per-person cap), plus `usedCount` and `isActive`. Run
`npm run migrate:vouchers` once — the unique indexes it builds are what the redeem lookup and the
redemption dedupe depend on.

**Two independent limits.** `maxUses` caps redemptions across everyone; `maxUsesPerApplicant` caps
one person, counted by **email** across all their enrollments (an applicant can hold several — a
second pathway, or a restarted application — so a cap scoped to one enrollment wouldn't be a cap).
The per-person check is `voucherApplicantRejection`: async and applicant-specific, so it can't live
inside `voucherRejection`, but the two are always called together — at apply time and again at
checkout. Its message is deliberately specific ("You have already used this voucher") because it
describes the caller's own history and so gives away nothing about which codes exist.

**`appliesTo` decides what the discount comes off, which is a separate question from how big it
is** — and the two settings have opposite revenue consequences:

- `'total'` (default) — a real giveaway. `applyVoucherToEnrollment` sets `enrollment.amount` to the
  *net* payable and writes two `feeBreakdown` lines that reconcile to it (the contract
  `assertBreakdownTotals` already enforces), so everything downstream — statement of account,
  receipts, the admin balance column — picks the discount up unchanged. On the `upfront` plan the
  reservation fee is still charged in full and the saving comes off the balance.
- `'upfront'` — lowers only the fee due at checkout. `enrollment.amount` and `feeBreakdown` are
  deliberately left at list price, so the saving reappears as a larger balance and the academy
  collects the same total. `upfrontChargeFor` applies it, from the **snapshot** rather than
  recomputing, so an admin editing the pathway fee later can't change what an applicant was quoted.
  It does nothing for a pay-in-full applicant — the payment step says so explicitly.

`enrollment.voucher` is a **snapshot** (`enrollmentVoucherSchema`), not a live join: editing or
deleting a `Voucher` never rewrites what someone was already quoted or charged. It carries
`listAmount` (always the undiscounted total) and `baseAmount` (whatever the discount was computed
against), so re-applying or removing a code recomputes from the original price instead of stacking.

- `POST`/`DELETE /api/enrollments/:id/voucher` are **public** (the enrollment flow isn't
  authenticated) and rate-limited well below the global limiter, since this is the one endpoint that
  reveals whether a code exists. An unknown code and a deactivated one return the *same* message on
  purpose — do not make these distinguishable.
- `voucherRejection` is the single definition of "why this code is refused". `/payment-session`
  re-runs it at the moment checkout opens and strips a code that lapsed in between, returning 409
  with the corrected total — the price is never taken from the browser.
- `VoucherRedemption` is the log of **who actually used a code** — one row per confirmed redemption,
  carrying the applicant's name/email, the learner account created, the enrollment, and what the
  discount was worth. Everything identifying is snapshotted, for the same reason
  `enrollment.voucher` is. Read via `GET /api/admin/vouchers/:id/redemptions` (admin-only, fetched
  on demand rather than bundled into the list — it's applicant PII) and shown in an expandable
  panel per voucher.
- Redemption is recorded **only** from `markEnrollmentPaid` (`claimVoucherUse`), so an abandoned
  checkout can't burn a use. **The log row is written first**, and its unique
  `(voucherId, enrollmentId)` index is what makes the whole claim idempotent — a replayed webhook
  collides and returns before touching the counter. The `$inc` is then conditional on
  `usedCount < maxUses`, which is what makes two *different* applicants racing for the last use
  safe. `claimVoucherUse` runs after `provisionLearnerAccount` so it can name the account, and reads
  the learner back by email selecting `_id` only — `provisionLearnerAccount`'s return value is
  echoed into an API response by the demo route, and a `User` document carries a password hash.
  It never throws: a miscounted voucher must not fail the payment that triggered it.
- Admin CRUD is `requireAuth` + `requireAdmin` under `/api/admin/vouchers`. A voucher with
  `usedCount > 0` cannot be deleted (it explains why those enrollments paid less than list price) —
  deactivate it instead.
- A code that zeroes out whatever it targets is refused at apply time: PayMongo can't open a session
  with no payable balance, so it needs a human. `MINIMUM_CHARGE_AMOUNT` is the floor, and it's
  checked against the amount **in scope** (the fee for an `upfront` code, the total otherwise).

## Learner profiles and enrollment documents

`User` carries the profile fields the admission form already asks for — `birthDate`, `school`,
`degree` — plus learner-supplied `username` (their preferred name, shown as `@handle`),
`facebookUrl`, `bio`, `headline`, `location`. `applyIntakeToProfile` (`server/profile.js`, its own
module so `migrate-backfill-profiles.js` can import it without booting the HTTP server) seeds the
first three from `enrollment.intake.data` inside `provisionLearnerAccount`. **Blank fields only** —
a learner approved for a second pathway keeps whatever they edited themselves. Run
`npm run migrate:backfill-profiles` once for learners provisioned before this existed.

`PATCH /api/users/me` (`profileInput`) is self-serve; `name`/`email` are deliberately excluded
because they come from the signed agreement and are what staff match records against — only
`adminUserUpdateInput` can change them. `facebookUrl` is regex-restricted to real Facebook hosts so
a profile page can't become an open redirect under academy branding.

`GET /api/users/:id` returns the profile to any authenticated caller but strips `birthDate` for
anyone who isn't the owner or staff (`publicProfile`), and only attaches `enrollments` — the
submitted admission form and signed agreements — for staff. **The response never contains storage
keys**; `enrollmentDocuments`/`ENROLLMENT_DOCUMENT_TYPES` expose only type, label, and signedAt.
Staff read a file through `GET /api/staff/enrollments/:id/documents/:type`
(`application` | `realex-reblex` | `reclex`), which re-authorizes the caller, streams via
`sendPrivateDownload`, and writes an `enrollment.document_viewed` audit row every time. Entry
points: the Documents column on `AdminEnrollmentsPage`, and a Profile link from the admin User
Management rows and the instructor Student Roster. `GET /api/staff/enrollments` returns a summary
only — the raw intake answers and PDF keys stay server-side.

## Submissions review (instructors)

The old Gradebook grid is now **Submissions** (`/submissions`; `/gradebook` redirects, since
notifications already sent carry the old path). `GET /api/staff/courses/:id/submissions` merges
assignment `Submission`s and `QuizAttempt`s into one feed with a shared shape (`kind`, `title`,
`learner`, `submittedAt`, `score`/`maxPoints`, `status`), sorted newest first; filtering by type,
status, and search happens client-side in `SubmissionsPage`.

**Quiz attempts are now persisted** (`QuizAttempt`). They previously were graded in memory and
discarded, so a learner could sit a quiz leaving nothing an instructor could review. Writing the
attempt is best-effort inside `POST /api/quizzes/:id/attempt` — a failed write logs and still
returns the learner their result. A question the auto-grader can't judge stores `correct: null`
(essay), which is what flags an attempt as `needs_grading`; `POST /api/staff/quiz-attempts/:id/review`
records an instructor's `reviewedScore` override and `feedback`.

Reviewing one item is a **page**, not a modal: `/submissions/:kind/:id` (`assignment` | `quiz`,
matched in `LmsPageContent`), two columns — the submitted work on the left (written response,
inline image/PDF preview of the attachment), grading and the comment thread on the right.
`GET /api/staff/submissions/:id` backs the assignment side so the page is deep-linkable without
first loading a whole course gradebook. **Grading records a score only** — the `feedback` field
still exists on the model and the API still accepts it, but the UI deliberately routes all written
communication through the comment thread instead, so there is one place a learner reads and replies.

`SubmissionComment` now hangs off **either** `submissionId` or `quizAttemptId` — a `pre('validate')`
hook enforces exactly one. That hook takes **no `next` parameter**: under Mongoose 9 a hook
declaring `next` fails with "next is not a function", so it's promise-based and throws instead.
`loadCommentTarget`/`listComments`/`createComment` in `server/index.js` serve both
`/api/submissions/:id/comments` and `/api/quiz-attempts/:id/comments` from one implementation.

## Automatic badge rules

`BadgeRule` (instructor-defined, per course) lets a badge be awarded the moment a learner meets a
condition — no manual step. Four trigger types: `course_completion`, `module_milestone`,
`score_threshold` (an assignment or quiz, by percent), `attendance_count` (sessions marked
present/late). `targetScope` is `'course'` (everyone the triggering event already concerns) or
`'selected'` (a hand-picked `learnerIds` list) — the *who*, independent of the *when*.

There's no background job runner in this app, so rules aren't evaluated on a schedule. `evaluateBadgeRules`
→ `runBadgeRules`/`badgeRuleSatisfied` (`server/index.js`, just above `/api/badges/me`) are called inline
from the five routes that can make a trigger newly true: module completion, assignment grading, a quiz
attempt (auto-graded), a quiz-attempt review (score override), and attendance recording. Each call passes
only the `triggerTypes` that write could possibly affect, so e.g. grading an assignment never re-checks
attendance rules. `StudentBadge`'s unique `(badgeId, learnerId)` index is what makes this idempotent —
**a badge is awarded once, ever, regardless of which rule grants it**; two rules sharing a badge doesn't
double-award, it just means either path can trigger it. System-issued awards carry `awardedByRuleId`
instead of `awardedBy` (no human awarder). Never throws — a badge miscalculation must not fail the
grade/attendance/completion write that triggered it.

Client: `RecognitionPage.jsx`. `BadgeManager` is a minimal create/list panel — nothing else in the app
lets staff create a `Badge`, so rules would have nothing to reference without it. Manual one-off awarding
(`POST /api/staff/badges/:badgeId/award`) exists server-side but has no UI; only the automatic path does.

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
