# Tree Academy LMS

> 📖 **New here, or not a developer?** Read [OVERVIEW.md](OVERVIEW.md) — a plain-language tour of
> every tool this application uses and how they fit together. The rest of this file assumes you write code.

## PASS-FIRST enrollment flow

The enrollment route (`/enroll`) now guides a learner through:

1. Contact details and enrollment review.
2. The PASS-FIRST REBLEX 2027 application, based on the supplied HTML form.
3. The supplied **REALEX / REBLEX** and **RECLEX** templates, completed through validated digital forms and drawn signatures.
4. Server-generated, flattened, signed PDF copies stored outside the public web root and emailed to the academy notification address.
5. PayMongo Hosted Checkout. A verified payment webhook creates an invited LMS learner account and sends the account-setup email.

The original PDF templates are included in `public/enrollment-documents/` for browser reference and in `server/templates/` for server-side PDF generation. Generated enrollment PDFs are stored under `server/private-storage/`, which is intentionally ignored by Git.

## Configuration

Copy `.env.example` to `.env` and set production values. Do not commit `.env`.

Required for production:

```ini
NODE_ENV=production
CLIENT_URL=https://your-lms-domain.example
MONGODB_URI=mongodb+srv://...
JWT_SECRET=long-random-secret

PAYMONGO_SECRET_KEY=sk_live_...
PAYMONGO_WEBHOOK_SECRET=webhook-signing-secret
PAYMONGO_PAYMENT_METHODS=gcash,paymaya,card,qrph

RESEND_API_KEY=re_...
EMAIL_FROM=Tree Academy <enrollments@your-verified-domain.example>
ENROLLMENT_NOTIFICATION_TO=trainwithmastersonline@gmail.com
```

`PAYMONGO_PAYMENT_LINK` is pre-filled with the supplied page link. It is a fallback only; a reusable payment link cannot reliably identify which individual enrollment paid. Once `PAYMONGO_SECRET_KEY` is set, the app creates a unique PayMongo checkout session for every enrollment instead.

## PayMongo go-live

1. Add a publicly reachable HTTPS webhook in the PayMongo dashboard: `https://your-api-domain.example/api/webhooks/paymongo`.
2. Subscribe it to `checkout_session.payment.paid`.
3. Save the webhook signing secret as `PAYMONGO_WEBHOOK_SECRET`.
4. Use a test secret key first, perform a test payment, and confirm the database enrollment changes to `approved` and the account-setup email is sent.
5. Repeat with the live key only after the test flow succeeds.

The API keeps the PayMongo secret key on the server, uses an idempotency key for session creation, verifies the PayMongo webhook signature against the raw request body, and deduplicates webhook event IDs.

## Local development

```bash
npm run dev:all
```

The client runs on port 5173 and the API on port 4000 by default. MongoDB is required for production; without it, the API uses temporary memory records strictly for local preview.

`src/lib/lmsPages.js` still auto-discovers every `.jsx` file under `src/pages/lms` and derives its route/label from the filename (nested folders become nested paths, so `src/pages/lms/reports/ReviewPage.jsx` becomes `/reports/review`) — that's what powers real in-app routing (`getLmsPage`). The floating dev-only page navigator that used to sit on top of this for quick manual jumps between roles/pages has been removed; use the app's own navigation (or sign in as a seeded account per role via `npm run seed:dummy`) instead.
