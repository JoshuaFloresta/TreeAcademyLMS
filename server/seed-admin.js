import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { config } from './config.js'
import { User } from './models.js'

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL
  const password = process.env.SEED_ADMIN_PASSWORD
  const name = process.env.SEED_ADMIN_NAME ?? 'Tree Academy Admin'
  if (!email || !password) {
    console.error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD before running this script.')
    process.exitCode = 1
    return
  }
  if (!config.mongoUri) {
    console.error('MONGODB_URI is not set. The admin seed requires a real database connection.')
    process.exitCode = 1
    return
  }

  await mongoose.connect(config.mongoUri)
  const normalizedEmail = email.toLowerCase()
  let admin = await User.findOne({ email: normalizedEmail })
  const passwordHash = await bcrypt.hash(password, 12)
  if (admin) {
    admin.name = name
    admin.role = 'admin'
    admin.status = 'active'
    admin.passwordHash = passwordHash
    admin.mustChangePassword = false
    await admin.save()
    console.log(`Updated existing user ${normalizedEmail} to an active admin.`)
  } else {
    await User.create({ name, email: normalizedEmail, role: 'admin', status: 'active', passwordHash })
    console.log(`Created admin user ${normalizedEmail}.`)
  }
  await mongoose.disconnect()
}

seedAdmin().catch((error) => {
  console.error('Admin seed failed:', error)
  process.exitCode = 1
})
