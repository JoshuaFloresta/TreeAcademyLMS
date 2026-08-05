// Migration for the voucher/discount system.
//
// Mongoose builds indexes on boot when autoIndex is on, but production deployments usually run with
// it off — and this feature's correctness depends on one index existing: `code` must be UNIQUE, or
// two vouchers with the same code can be created and the redeem lookup becomes ambiguous. This runs
// that index creation explicitly, and reports anything already in the data that would prevent it.
//
// Safe to re-run: syncIndexes is idempotent, and the collision scan below only reports.
import mongoose from 'mongoose'
import { config } from './config.js'
import { EmailTemplate, Enrollment, Voucher, VoucherRedemption } from './models.js'
import { emailTemplateDefaults } from './email.js'

async function migrate() {
  if (!config.mongoUri) {
    console.error('MONGODB_URI is not set. This migration requires a real database connection.')
    process.exitCode = 1
    return
  }
  await mongoose.connect(config.mongoUri)

  // Duplicates can only pre-exist if vouchers were inserted by hand before this shipped, but the
  // unique index build would fail on them with a message that doesn't say which code is at fault.
  const duplicates = await Voucher.aggregate([
    { $group: { _id: { $toUpper: '$code' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ])
  if (duplicates.length) {
    console.error('Cannot build the unique index — these codes appear more than once:')
    for (const row of duplicates) console.error(`   ${row._id} × ${row.count}`)
    console.error('\nRemove or rename the duplicates, then run this again.')
    await mongoose.disconnect()
    process.exitCode = 1
    return
  }

  await Voucher.syncIndexes()
  console.log('Voucher indexes synced (unique on `code`).')

  // `appliesTo` arrived after the first vouchers could already exist. Mongoose applies the schema
  // default when a document is hydrated, but `.lean()` reads skip hydration — so the field is
  // written explicitly rather than left to be inferred differently depending on how it's queried.
  const scoped = await Voucher.updateMany({ appliesTo: { $exists: false } }, { $set: { appliesTo: 'total' } })
  if (scoped.modifiedCount) console.log(`Set appliesTo="total" on ${scoped.modifiedCount} pre-existing voucher(s).`)
  const capped = await Voucher.updateMany({ maxUsesPerApplicant: { $exists: false } }, { $set: { maxUsesPerApplicant: 0 } })
  if (capped.modifiedCount) console.log(`Set maxUsesPerApplicant=0 (no per-person cap) on ${capped.modifiedCount} pre-existing voucher(s).`)

  // The redemption log's unique (voucherId, enrollmentId) index is not a nicety — it is what makes
  // a replayed payment webhook unable to count the same redemption twice.
  await VoucherRedemption.syncIndexes()
  console.log('VoucherRedemption indexes synced (unique on voucherId+enrollmentId).')

  // The enrollment side needs no backfill: `voucher` defaults to null and `amount` already holds
  // the payable total, so an enrollment created before this feature is simply one with no discount.
  // The payment receipt gained a discount line. ensureDefaultEmailTemplates seeds with $setOnInsert
  // and never rewrites an existing row, so a database that has already booted this app is holding
  // the old body and would keep emailing receipts with no mention of the voucher.
  //
  // `updatedBy` is set only by the admin PATCH route, so a null value means the row is still the
  // untouched seed and is safe to refresh. A customized template is NEVER overwritten — the admin's
  // wording is theirs to keep, so this prints what to paste instead.
  const receipt = await EmailTemplate.findOne({ key: 'payment_receipt' })
  if (!receipt) {
    console.log('\nNo stored payment_receipt template — the app will seed the new one (with the discount line) on next boot.')
  } else if (receipt.body.includes('{{#hasDiscount}}')) {
    console.log('\nPayment receipt already carries the discount line — left as is.')
  } else if (receipt.updatedBy) {
    console.log('\nATTENTION: your payment_receipt template has been customized in Settings > Email Automation,')
    console.log('so it was NOT overwritten. Receipts will keep sending without a discount line until you add one.')
    console.log('To add it, paste this inside the receipt table, just above the "Amount paid" row:\n')
    console.log('{{#hasDiscount}}<tr><td class="receipt-label-cell">{{discountBaseLabel}}</td><td class="receipt-value-cell">{{discountBaseAmount}}</td></tr>')
    console.log('<tr class="receipt-discount"><td class="receipt-label-cell">Voucher {{voucherCode}} ({{discountLabel}})</td><td class="receipt-value-cell">&minus;{{discountAmount}}</td></tr>{{/hasDiscount}}\n')
  } else {
    receipt.body = emailTemplateDefaults.payment_receipt.body
    receipt.subject = emailTemplateDefaults.payment_receipt.subject
    await receipt.save()
    console.log('\nPayment receipt template refreshed with the discount line (it had never been hand-edited).')
  }

  const [vouchers, discounted, redemptions] = await Promise.all([
    Voucher.countDocuments({}),
    Enrollment.countDocuments({ 'voucher.code': { $exists: true, $ne: null } }),
    VoucherRedemption.countDocuments({}),
  ])
  console.log(`${vouchers} voucher(s) on file; ${discounted} enrollment(s) currently carry a discount; ${redemptions} logged redemption(s).`)
  console.log('\nCreate codes in the admin console at /admin/vouchers.')

  await mongoose.disconnect()
}

migrate().catch((error) => {
  console.error('Voucher migration failed:', error)
  process.exitCode = 1
})
