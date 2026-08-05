import express from 'express'
import { Voucher, VoucherRedemption } from '../models.js'
import { requireAdmin, requireAuth } from '../security.js'
import { dbState } from '../state.js'
import { asyncRoute } from '../lib/http.js'
import { saveAudit } from '../lib/audit.js'
import { assertVoucherValueInRange, publicVoucher, voucherInput, voucherPatchInput } from '../lib/vouchers.js'

export const router = express.Router()

// --- Voucher administration. Admin-only: a discount code is a lever on revenue, so it sits with
// pricing rather than with the instructor-facing staff routes.

router.get('/api/admin/vouchers', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Vouchers require MongoDB.' })
  const vouchers = await Voucher.find().sort({ createdAt: -1 }).lean()
  res.json(vouchers.map(publicVoucher))
}))

// Who actually redeemed a code. Admin-only and deliberately not part of the list payload — it's
// applicant PII (name + email), so it's fetched on demand for one voucher rather than shipped with
// every row of the management screen.
router.get('/api/admin/vouchers/:id/redemptions', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Vouchers require MongoDB.' })
  const rows = await VoucherRedemption.find({ voucherId: req.params.id }).sort({ redeemedAt: -1 }).limit(500).lean()
  res.json(rows.map((row) => ({
    id: row._id.toString(),
    // The learner account, so the admin can open the profile of whoever used it. Null when payment
    // succeeded but account creation didn't — the redemption is still on the record either way.
    userId: row.userId ? String(row.userId) : null,
    enrollmentId: String(row.enrollmentId),
    name: row.applicantName ?? '—',
    email: row.applicantEmail,
    pathway: row.pathway ?? null,
    appliesTo: row.appliesTo ?? 'total',
    discountAmount: row.discountAmount ?? 0,
    amountCharged: row.amountCharged ?? 0,
    redeemedAt: row.redeemedAt,
  })))
}))

router.post('/api/admin/vouchers', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Vouchers require MongoDB.' })
  const values = voucherInput.parse(req.body)
  assertVoucherValueInRange(values.discountType, values.discountValue)
  // Checked before insert so a duplicate reads as a clear conflict instead of surfacing a raw
  // Mongo E11000 as a generic 500. The unique index is still the actual guarantee.
  if (await Voucher.exists({ code: values.code })) return res.status(409).json({ error: 'A voucher with that code already exists.' })
  const voucher = await Voucher.create({ ...values, createdBy: req.auth.sub })
  await saveAudit('voucher.created', 'Voucher', voucher.id, { code: voucher.code, discountType: voucher.discountType, discountValue: voucher.discountValue }, req.auth.sub)
  res.status(201).json(publicVoucher(voucher))
}))

router.patch('/api/admin/vouchers/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Vouchers require MongoDB.' })
  const values = voucherPatchInput.parse(req.body)
  const voucher = await Voucher.findById(req.params.id)
  if (!voucher) return res.status(404).json({ error: 'Voucher not found.' })
  assertVoucherValueInRange(values.discountType ?? voucher.discountType, values.discountValue ?? voucher.discountValue)
  if (values.code && values.code !== voucher.code && await Voucher.exists({ code: values.code })) {
    return res.status(409).json({ error: 'A voucher with that code already exists.' })
  }
  // An already-issued code is edited in place rather than versioned: enrollments snapshot the terms
  // they were quoted (see enrollmentVoucherSchema), so changing a live voucher never rewrites what
  // anyone was already charged.
  Object.assign(voucher, values)
  await voucher.save()
  await saveAudit('voucher.updated', 'Voucher', voucher.id, values, req.auth.sub)
  res.json(publicVoucher(voucher))
}))

router.delete('/api/admin/vouchers/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Vouchers require MongoDB.' })
  const voucher = await Voucher.findById(req.params.id)
  if (!voucher) return res.status(404).json({ error: 'Voucher not found.' })
  // A redeemed voucher is the explanation for why some enrollments were charged less than list
  // price, and it owns a redemption log naming the people who used it. Deleting it would orphan
  // both, so a spent code is switched off instead — which stops it working just as completely.
  // The log is checked as well as the counter: they can disagree if a redemption landed after the
  // code was already at its limit (see claimVoucherUse), and either one means "this was used".
  if (voucher.usedCount > 0 || await VoucherRedemption.exists({ voucherId: voucher._id })) {
    return res.status(409).json({ error: 'This voucher has already been redeemed and is part of the payment record. Deactivate it instead — that stops it being accepted.' })
  }
  await voucher.deleteOne()
  await saveAudit('voucher.deleted', 'Voucher', req.params.id, { code: voucher.code }, req.auth.sub)
  res.status(204).end()
}))
