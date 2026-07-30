import 'dotenv/config'

const bool = (value) => value === 'true'

const list = (value) => (value ?? '').split(',').map((entry) => entry.trim().replace(/\/$/, '')).filter(Boolean)

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  // Canonical client origin — used for links inside emails and as the default CORS origin.
  clientUrl: (process.env.CLIENT_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  // Extra browser origins allowed to call the API with credentials. Needed when the frontend is
  // hosted separately (e.g. Vercel) and for per-branch preview deployments.
  additionalClientOrigins: list(process.env.ADDITIONAL_CLIENT_ORIGINS),
  // Regex source matched against the Origin header, for hosts that mint a new subdomain per
  // deploy (e.g. `^https://treeacademy-[a-z0-9-]+\.vercel\.app$`). Never leave this open-ended.
  clientOriginPattern: process.env.CLIENT_ORIGIN_PATTERN,
  mongoUri: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  docusign: {
    integrationKey: process.env.DOCUSIGN_INTEGRATION_KEY,
    accountId: process.env.DOCUSIGN_ACCOUNT_ID,
    webhookSecret: process.env.DOCUSIGN_WEBHOOK_SECRET,
    templateId: process.env.DOCUSIGN_TEMPLATE_ID,
  },
  paymongo: {
    secretKey: process.env.PAYMONGO_SECRET_KEY,
    webhookSecret: process.env.PAYMONGO_WEBHOOK_SECRET,
    paymentLink: process.env.PAYMONGO_PAYMENT_LINK ?? 'https://paymongo.page/l/treeacademypayment',
    paymentMethods: (process.env.PAYMONGO_PAYMENT_METHODS ?? 'gcash,paymaya,card,qrph').split(',').map((method) => method.trim()).filter(Boolean),
  },
  email: {
    resendApiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
    enrollmentRecipient: process.env.ENROLLMENT_NOTIFICATION_TO ?? 'trainwithmastersonline@gmail.com',
  },
  newsletter: {
    makeWebhookUrl: process.env.MAKE_NEWSLETTER_WEBHOOK_URL,
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:4000/api/auth/google/callback',
  },
  storage: {
    // Used only by the local-disk backend (development). Ignored once S3_* is configured.
    privateDirectory: process.env.PRIVATE_STORAGE_DIR ?? 'server/private-storage',
    // S3-compatible object storage. Required in production: Render/Vercel/Fly filesystems are
    // ephemeral, so signed agreements and certificates written to disk are lost on every restart.
    s3: {
      bucket: process.env.S3_BUCKET,
      region: process.env.S3_REGION ?? 'auto',
      endpoint: process.env.S3_ENDPOINT,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      // OPTIONAL second bucket for avatars/course banners only. Public read access is granted per
      // bucket, so the main bucket above must stay private — it holds signed agreements. Leave
      // both of these unset to serve images through the API instead (safe default).
      publicBucket: process.env.S3_PUBLIC_BUCKET,
      publicBaseUrl: process.env.S3_PUBLIC_BASE_URL,
    },
  },
  demoMode: bool(process.env.DEMO_MODE ?? 'true'),
}

export const isProduction = config.nodeEnv === 'production'

// Shared by the HTTP CORS middleware and the Socket.IO handshake so both accept exactly the same
// set of origins. In development any localhost port is allowed (Vite falls back to 5174+ when
// 5173 is busy); in production only the configured client origins and an optional preview-deploy
// pattern are — never a wildcard, since these requests carry credentials.
const originPattern = config.clientOriginPattern ? new RegExp(config.clientOriginPattern) : null

export function isAllowedOrigin(origin) {
  // Same-origin/non-browser callers (PayMongo webhooks, curl, health checks) send no Origin header.
  if (!origin) return true
  const normalized = origin.replace(/\/$/, '')
  if (normalized === config.clientUrl) return true
  if (config.additionalClientOrigins.includes(normalized)) return true
  if (originPattern?.test(normalized)) return true
  if (!isProduction) return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized)
  return false
}

export const integrations = {
  docusign: Boolean(config.docusign.integrationKey && config.docusign.accountId && config.docusign.templateId),
  paymongo: Boolean(config.paymongo.secretKey),
}
