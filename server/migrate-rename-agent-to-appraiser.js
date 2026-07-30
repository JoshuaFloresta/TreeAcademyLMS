// One-off migration: the "agent" enrollment pathway was renamed to "appraiser" (its course's
// display title was already "Appraiser Review" — only the internal pathway id, course slug, and
// pricing field names lagged behind). This brings existing data in line with the renamed code:
//   - the Course with slug 'agent-review'            -> 'appraiser-review'
//   - every Enrollment.applicant.pathway 'agent'      -> 'appraiser'
//   - the PricingSettings singleton's totalAgent/upfrontAgent -> totalAppraiser/upfrontAppraiser
// PricingSettings uses Model.collection (raw driver access) since its schema no longer declares the
// old field names, so a normal Mongoose read would silently drop them before we could copy them over.
import mongoose from 'mongoose'
import { config } from './config.js'
import { Course, Enrollment, PricingSettings } from './models.js'

async function migrate() {
  if (!config.mongoUri) {
    console.error('MONGODB_URI is not set. This migration requires a real database connection.')
    process.exitCode = 1
    return
  }
  await mongoose.connect(config.mongoUri)

  const courseResult = await Course.updateOne({ slug: 'agent-review' }, { $set: { slug: 'appraiser-review' } })
  console.log(courseResult.matchedCount ? 'Renamed course slug agent-review -> appraiser-review.' : 'No course with slug "agent-review" found (already renamed?).')

  const enrollmentResult = await Enrollment.updateMany({ 'applicant.pathway': 'agent' }, { $set: { 'applicant.pathway': 'appraiser' } })
  console.log(`Updated ${enrollmentResult.modifiedCount} enrollment(s) from pathway "agent" to "appraiser".`)

  const raw = await PricingSettings.collection.findOne({})
  if (raw && (raw.totalAgent !== undefined || raw.upfrontAgent !== undefined)) {
    await PricingSettings.collection.updateOne({ _id: raw._id }, {
      $set: { totalAppraiser: raw.totalAgent ?? 14900, upfrontAppraiser: raw.upfrontAgent ?? 1000 },
      $unset: { totalAgent: '', upfrontAgent: '' },
    })
    console.log(`Migrated pricing fields: totalAgent(${raw.totalAgent}) -> totalAppraiser, upfrontAgent(${raw.upfrontAgent}) -> upfrontAppraiser.`)
  } else {
    console.log('No legacy totalAgent/upfrontAgent pricing fields found (already migrated?).')
  }

  await mongoose.disconnect()
}

migrate().catch((error) => {
  console.error('Migration failed:', error)
  process.exitCode = 1
})
