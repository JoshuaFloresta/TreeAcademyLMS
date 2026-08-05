import express from 'express'
import { z } from 'zod'
import { Certificate, Enrollment, StudentBadge, User } from '../models.js'
import { requireAuth } from '../security.js'
import { dbState } from '../state.js'
import { asyncRoute } from '../lib/http.js'
import { avatarUpload, saveAvatarUpload } from '../lib/uploads.js'
import { sessionUser } from '../lib/session.js'
import { saveAudit } from '../lib/audit.js'
import { enrollmentDocuments } from '../lib/enrollment-doc-meta.js'
import { blankToNull, usernameField } from '../lib/zod-helpers.js'

export const router = express.Router()

// Only accept real Facebook profile links. Left open it becomes an unmoderated outbound link on a
// page every logged-in member can view — a free redirect to anywhere, rendered under our branding.
const facebookUrlField = z.string().trim().max(300)
  .refine((value) => /^https:\/\/(www\.|m\.|web\.)?(facebook\.com|fb\.me|fb\.com)\/[^\s]*$/i.test(value), 'Enter a full Facebook profile link, e.g. https://facebook.com/yourname')
// Fields a member may change on their own profile. Deliberately excludes `name` and `email`: those
// come from the signed enrollment agreement and are what staff match records against, so only an
// admin can change them (see adminUserUpdateInput).
const profileInput = z.object({
  bio: z.string().trim().max(600).optional(),
  headline: z.string().trim().max(120).optional(),
  location: z.string().trim().max(120).optional(),
  username: blankToNull(usernameField),
  birthDate: blankToNull(z.coerce.date().min(new Date('1900-01-01'), 'Enter a valid date of birth.').max(new Date(), 'Date of birth cannot be in the future.')),
  school: blankToNull(z.string().trim().max(200)),
  degree: blankToNull(z.string().trim().max(200)),
  facebookUrl: blankToNull(facebookUrlField),
})

const PROFILE_FIELDS = 'name email username role avatarUrl bio headline location birthDate school degree facebookUrl createdAt'

// Birth date is the one profile field peers never see: it's identity-verification material, and it
// arrives from the enrollment form rather than being volunteered publicly. Owners and staff do see
// it, because staff need it to match a learner against their signed agreement.
const publicProfile = (user, { privileged }) => (privileged ? user : { ...user, birthDate: undefined })

router.get('/api/users/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Profiles require MongoDB.' })
  const user = await User.findById(req.params.id).select(PROFILE_FIELDS).lean()
  if (!user) return res.status(404).json({ error: 'User not found.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  const privileged = isStaff || String(user._id) === req.auth.sub
  const [badges, certificates, enrollments] = await Promise.all([
    StudentBadge.find({ learnerId: user._id }).populate('badgeId', 'title description color icon').sort({ createdAt: -1 }).lean(),
    Certificate.find({ learnerId: user._id }).populate('templateId', 'title scope').sort({ createdAt: -1 }).lean(),
    // Staff open a member's profile to check what that person actually signed, so the submitted
    // application and agreement are surfaced here. Only staff — a learner never sees another
    // learner's paperwork, and the keys themselves are never sent (see enrollmentDocuments).
    isStaff ? Enrollment.find({ 'applicant.email': user.email }).sort({ createdAt: -1 }).lean() : [],
  ])
  res.json({
    user: publicProfile(user, { privileged }),
    badges,
    certificates,
    ...(isStaff && { enrollments: enrollments.map((row) => ({ id: String(row._id), pathway: row.applicant?.pathway, status: row.status, createdAt: row.createdAt, documents: enrollmentDocuments(row) })) }),
  })
}))

router.patch('/api/users/me', requireAuth, asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Profile updates require MongoDB.' })
  const updates = profileInput.parse(req.body)
  // `username` is uniquely indexed, so check before writing to return a readable message instead of
  // a raw duplicate-key error. Excluding self keeps re-saving an unchanged profile from 409-ing.
  if (updates.username && await User.findOne({ username: updates.username, _id: { $ne: req.auth.sub } }).select('_id').lean()) {
    return res.status(409).json({ error: 'That preferred name is already taken.' })
  }
  const user = await User.findByIdAndUpdate(req.auth.sub, updates, { new: true, runValidators: true }).select(PROFILE_FIELDS)
  if (!user) return res.status(404).json({ error: 'User not found.' })
  // Field *names* only — the values are personal data and audit rows are read by every admin.
  await saveAudit('user.profile_updated', 'User', user.id, { fields: Object.keys(updates) }, user.id)
  res.json(user)
}))

router.post('/api/users/me/avatar', requireAuth, avatarUpload.single('avatar'), asyncRoute(async (req, res) => {
  if (!dbState.ready) return res.status(503).json({ error: 'Avatar uploads require MongoDB.' })
  if (!req.file) return res.status(400).json({ error: 'Choose a JPG, PNG, or WEBP image under 3MB.' })
  const avatarUrl = await saveAvatarUpload(req.file)
  const user = await User.findByIdAndUpdate(req.auth.sub, { avatarUrl }, { new: true })
  await saveAudit('user.avatar_updated', 'User', user.id, {}, user.id)
  res.json({ avatarUrl, user: sessionUser(user) })
}))
