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
