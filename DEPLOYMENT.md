# Deployment

Tree Academy runs as **two separate deployments**:

| Piece | Host | Why |
| --- | --- | --- |
| React frontend (`dist/`) | **Vercel** | Static SPA — Vercel's strength. |
| Express API (`server/`) | **Render** | Needs a long-running process for Socket.IO presence. Vercel's serverless functions cannot hold WebSocket connections. |
| Files (signed PDFs, certificates, avatars) | **Cloudflare R2** | Render's disk is wiped on every restart/redeploy. |
| Database | **MongoDB Atlas** | — |

Local development is unaffected: with no `S3_*` variables set, files go to `server/private-storage/`
exactly as before, and `npm run dev:all` still works with zero external services.

---

## 1. MongoDB Atlas

1. Create a free M0 cluster at [cloud.mongodb.com](https://cloud.mongodb.com).
2. **Database Access** → add a user, copy the password.
3. **Network Access** → add `0.0.0.0/0`. Render doesn't publish fixed egress IPs on the free plan;
   the connection is still protected by the username/password in the URI.
4. Copy the connection string — this is `MONGODB_URI`.

## 2. Cloudflare R2 (file storage)

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **R2** → create a bucket (e.g. `treeacademy`).
2. **Manage R2 API Tokens** → create a token with **Object Read & Write** scoped to that bucket.
   Copy the Access Key ID and Secret Access Key — the secret is shown only once.
3. Note your **Account ID** (right-hand sidebar). Your endpoint is:
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
4. *(Optional, for avatars/course banners)* Bucket → **Settings** → **Public access** → enable the
   `r2.dev` subdomain or attach a custom domain. Set the resulting URL as `S3_PUBLIC_BASE_URL`.
   Without it avatars still work — they're served through the API's `/uploads` route instead.

> Any S3-compatible provider works (AWS S3, Backblaze B2, MinIO); only the env values change.
> **Never make the bucket fully public** — it holds signed enrollment agreements. Only objects under
> the `public/` prefix are ever exposed by URL, and only if you configure `S3_PUBLIC_BASE_URL`.

### Moving your existing local files up

Run once, from your machine, with the R2 variables set. It uploads everything currently in
`server/private-storage/` plus legacy avatars, so existing enrollments keep their documents:

```bash
S3_BUCKET=treeacademy S3_ENDPOINT=https://<id>.r2.cloudflarestorage.com \
S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
npm run migrate:storage
```

## 3. Render (API)

1. [render.com](https://render.com) → **New** → **Web Service** → connect the GitHub repo.
2. Render reads `render.yaml` automatically. Confirm: Runtime **Node**, Build `npm install`,
   Start `npm start`.
3. **Environment** tab — add every value marked `sync: false`:

   | Variable | Value |
   | --- | --- |
   | `MONGODB_URI` | from step 1 |
   | `CLIENT_URL` | your Vercel production URL (no trailing slash) |
   | `CLIENT_ORIGIN_PATTERN` | `^https://<project>-[a-z0-9-]+\.vercel\.app$` — allows preview deploys |
   | `S3_BUCKET` / `S3_ENDPOINT` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | from step 2 |
   | `S3_PUBLIC_BASE_URL` | optional, from step 2 |
   | `PAYMONGO_SECRET_KEY` / `PAYMONGO_WEBHOOK_SECRET` | see step 5 |
   | `RESEND_API_KEY` / `EMAIL_FROM` / `ENROLLMENT_NOTIFICATION_TO` | your Resend setup |

   `NODE_ENV=production`, `DEMO_MODE=false` and a generated `JWT_SECRET` come from `render.yaml`.
4. Deploy, then copy the service URL (e.g. `https://treeacademy-api.onrender.com`).

> **Free plan caveat:** the service sleeps after ~15 minutes idle, so the next request takes
> ~30–50s to wake. Fine for testing; upgrade to Starter ($7/mo) before real learners use it —
> a sleeping API means PayMongo webhook retries and slow first page loads.

## 4. Vercel (frontend)

1. [vercel.com](https://vercel.com) → **Add New** → **Project** → import the same repo.
2. Vercel reads `vercel.json` (framework Vite, output `dist`, SPA rewrites for React Router).
3. **Settings → Environment Variables** → add `VITE_API_URL` = your Render URL, for
   *Production*, *Preview*, and *Development*.
4. Deploy, then copy the production URL and set it as `CLIENT_URL` back on Render (step 3).

> `VITE_API_URL` is baked in at **build time**, not read at runtime — after changing it you must
> redeploy the frontend, not just restart it.

## 5. PayMongo webhook

The webhook is what actually grants course access, so it must point at the **Render** URL, not Vercel:

1. PayMongo Dashboard → **Developers** → **Webhooks** → add endpoint:
   `https://<your-render-url>/api/webhooks/paymongo`
2. Subscribe to `checkout_session.payment.paid`.
3. Copy that webhook's signing secret into `PAYMONGO_WEBHOOK_SECRET` on Render.

**The webhook's mode must match your secret key's mode.** A `sk_live_…` key with a webhook created
in Test mode means payments succeed but never confirm — enrollments sit on "awaiting payment"
forever. Use `sk_test_…` + a Test-mode webhook until you're ready to take real money.

## 6. First admin

Render's shell is a paid feature, so seed the admin from your machine against the production
database (same command, just the production `MONGODB_URI`):

```bash
MONGODB_URI="<atlas-uri>" SEED_ADMIN_EMAIL=you@example.com \
SEED_ADMIN_PASSWORD='...' SEED_ADMIN_NAME='Admin' npm run seed:admin
```

---

## Working locally after going live

Nothing changes. `.env` stays pointed at localhost and your local Mongo/disk storage:

```bash
npm run dev:all     # client :5173 + API :4000
```

The API allows any `localhost` origin in development, so the local frontend keeps talking to the
local API regardless of what's configured in production.

**Pushing changes:** both hosts auto-deploy on push to `main`. Vercel additionally builds a unique
preview URL per branch/PR — those are covered by `CLIENT_ORIGIN_PATTERN`, so previews can call the
production API without a CORS change.

Careful when testing against production data locally: point `MONGODB_URI` at Atlas *only* when you
intend to, and keep `PAYMONGO_SECRET_KEY` on a test key so you never charge a real card.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Sign-in works, then logs out on refresh | `CLIENT_URL` on Render doesn't exactly match the frontend origin. The refresh cookie needs `SameSite=None; Secure`, which the API only sets when `NODE_ENV=production`. |
| CORS errors in the browser console | The calling origin isn't in `CLIENT_URL` / `ADDITIONAL_CLIENT_ORIGINS` / `CLIENT_ORIGIN_PATTERN`. Trailing slashes are ignored; scheme and port must match. |
| API won't boot: "S3_BUCKET … required in production" | Working as intended — object storage is mandatory in production so signed agreements survive redeploys. |
| Payment succeeds but stays "awaiting payment" | Webhook missing, pointed at Vercel instead of Render, or registered in the wrong PayMongo mode. Check `WebhookEvent` in Mongo — empty means nothing ever arrived. |
| Emails never arrive | `RESEND_API_KEY` unset, or `EMAIL_FROM` uses a domain not verified in Resend. `onboarding@resend.dev` only delivers to your own Resend signup address. |
| Avatars 404 after deploying | Run `npm run migrate:storage` with the R2 variables set to upload existing images. |
| First request after idle takes ~40s | Render free plan cold start. Upgrade to Starter. |
