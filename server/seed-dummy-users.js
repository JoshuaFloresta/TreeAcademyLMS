import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { config } from './config.js'
import { User } from './models.js'

// Seeds five ready-to-use accounts for local/testing use so the LMS can be exercised without
// running the full enrollment → approval flow for each one. Passwords are shared and known;
// override with SEED_DUMMY_PASSWORD. Accounts are created active (no invite step) so they can
// sign in immediately at /auth. Safe to re-run — existing emails are updated in place.
const DEFAULT_PASSWORD = process.env.SEED_DUMMY_PASSWORD ?? 'TreeAcademy123!'

const dummyUsers = [
  { name: 'Maria Santos', email: 'maria.learner@treeacademy.test', role: 'learner', headline: 'Broker Review candidate', location: 'Quezon City, PH' },
  { name: 'Ramon Cruz', email: 'ramon.learner@treeacademy.test', role: 'learner', headline: 'Appraiser Review candidate', location: 'Cebu City, PH' },
  { name: 'Divina Reyes', email: 'divina.learner@treeacademy.test', role: 'learner', headline: 'Consultant Review candidate', location: 'Davao City, PH' },
  { name: 'Mia Flores', email: 'mia.instructor@treeacademy.test', role: 'instructor', headline: 'Lead review instructor', location: 'Makati City, PH' },
  { name: 'Andres Bautista', email: 'andres.learner@treeacademy.test', role: 'learner', headline: 'Broker Review candidate', location: 'Iloilo City, PH' },
]

async function seedDummyUsers() {
  if (!config.mongoUri) {
    console.error('MONGODB_URI is not set. Seeding dummy users requires a real database connection.')
    process.exitCode = 1
    return
  }

  await mongoose.connect(config.mongoUri)
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12)

  for (const dummy of dummyUsers) {
    const email = dummy.email.toLowerCase()
    const fields = { name: dummy.name.trim(), role: dummy.role, headline: dummy.headline, location: dummy.location, status: 'active', passwordHash, mustChangePassword: false, inviteTokenHash: undefined, inviteExpiresAt: undefined }
    const existing = await User.findOne({ email })
    if (existing) {
      existing.set(fields)
      await existing.save()
      console.log(`Updated ${email} (${dummy.role}).`)
    } else {
      await User.create({ email, ...fields })
      console.log(`Created ${email} (${dummy.role}).`)
    }
  }

  console.log(`\nDone. ${dummyUsers.length} accounts ready. Shared password: ${DEFAULT_PASSWORD}`)
  console.log('Sign in at /auth with any of the emails above.')
  await mongoose.disconnect()
}

seedDummyUsers().catch((error) => {
  console.error('Dummy-user seed failed:', error)
  process.exitCode = 1
})
