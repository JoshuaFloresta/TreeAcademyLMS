import 'dotenv/config'

const bool = (value) => value === 'true'

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
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
    privateDirectory: process.env.PRIVATE_STORAGE_DIR ?? 'server/private-storage',
  },
  demoMode: bool(process.env.DEMO_MODE ?? 'true'),
}

export const isProduction = config.nodeEnv === 'production'

export const integrations = {
  docusign: Boolean(config.docusign.integrationKey && config.docusign.accountId && config.docusign.templateId),
  paymongo: Boolean(config.paymongo.secretKey),
}
