import crypto from 'node:crypto'
import express from 'express'
import mongoose from 'mongoose'
import { config } from '../config.js'
import { Enrollment, WebhookEvent } from '../models.js'
import { verifyHmac, verifyPaymongoSignature } from '../security.js'
import { dbState, memory } from '../state.js'
import { asyncRoute } from '../lib/http.js'
import { saveAudit } from '../lib/audit.js'
import { markEnrollmentPaid } from '../lib/enrollment-shared.js'

const id = () => crypto.randomUUID()

export const router = express.Router()

router.post('/api/webhooks/docusign', asyncRoute(async (req, res) => {
  if (!config.docusign.webhookSecret || !verifyHmac(req.rawBody, req.header('x-docusign-signature-1'), config.docusign.webhookSecret)) return res.status(401).json({ error: 'Invalid DocuSign webhook signature.' })
  const eventId = req.body?.data?.envelopeId ?? req.body?.event ?? id()
  const exists = dbState.ready && await WebhookEvent.exists({ provider: 'docusign', eventId })
  if (exists) return res.status(204).end()
  if (dbState.ready) await WebhookEvent.create({ provider: 'docusign', eventId, eventType: req.body?.event, processedAt: new Date() })
  // Provider adapter: retrieve the completed envelope PDF and transition only a completed envelope to contract_signed.
  res.status(204).end()
}))

router.post('/api/webhooks/paymongo', asyncRoute(async (req, res) => {
  const signature = req.header('paymongo-signature') ?? req.header('x-paymongo-signature')
  const isLiveEvent = req.body?.data?.attributes?.livemode === true
  if (!config.paymongo.webhookSecret || !verifyPaymongoSignature(req.rawBody, signature, config.paymongo.webhookSecret, isLiveEvent)) return res.status(401).json({ error: 'Invalid PayMongo webhook signature.' })
  const event = req.body?.data
  const eventId = event?.id
  if (!eventId) return res.status(400).json({ error: 'Missing webhook event id.' })
  const exists = dbState.ready && await WebhookEvent.exists({ provider: 'paymongo', eventId })
  if (exists) return res.status(204).end()
  const eventType = event?.attributes?.type
  const checkout = event?.attributes?.data
  if (eventType === 'checkout_session.payment.paid') {
    const referenceNumber = checkout?.attributes?.reference_number
    const checkoutId = checkout?.id
    let enrollment = null
    if (dbState.ready) {
      if (referenceNumber && mongoose.isValidObjectId(referenceNumber)) enrollment = await Enrollment.findById(referenceNumber)
      if (!enrollment && checkoutId) enrollment = await Enrollment.findOne({ 'payment.checkoutId': checkoutId })
    } else if (referenceNumber) enrollment = memory.enrollments.get(referenceNumber)

    if (enrollment) {
      const transactionId = checkout?.attributes?.payments?.[0]?.id ?? checkout?.attributes?.payment_intent?.id ?? checkoutId
      // The account is provisioned immediately on confirmed payment — no staff review step. This
      // still only runs from inside a signature-verified webhook event (see the check at the top
      // of this handler), so a browser redirect alone still never grants access on its own.
      const invitation = await markEnrollmentPaid(enrollment, {
        provider: 'paymongo',
        checkoutId,
        transactionId,
        referenceNumber: referenceNumber ?? enrollment.id,
        paidAt: new Date(),
      })
      await saveAudit('payment.paid_auto_approved', 'Enrollment', enrollment._id?.toString() ?? enrollment.id, { checkoutId, transactionId, delivery: invitation?.delivery })
    } else console.warn(`PayMongo payment ${eventId} could not be matched to an enrollment.`)
  }
  if (dbState.ready) await WebhookEvent.create({ provider: 'paymongo', eventId, eventType, processedAt: new Date() })
  res.status(204).end()
}))
