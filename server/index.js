import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import multer from 'multer'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { Server } from 'socket.io'
import { z } from 'zod'
import { config, integrations, isProduction } from './config.js'
import { catalog } from './catalog.js'
import { Announcement, Assignment, Attendance, Badge, CalendarEvent, Category, CategoryHeader, Certificate, CertificateTemplate, ContentAsset, Course, EmailTemplate, Enrollment, ForumPost, ForumThread, LearningModule, LearningProgress, Lesson, Module, NewsletterSubscriber, Notification, Presence, PricingSettings, Quiz, Report, RolePermission, StudentBadge, Submission, SubmissionComment, SupportTicket, Webinar, WebinarRegistration, WebhookEvent, AuditLog, RefreshToken, User } from './models.js'
import { createToken, hashToken, requireAdmin, requireAuth, requireStaff, signAccessToken, verifyHmac, verifyPaymongoSignature } from './security.js'
import { emailTemplateDefaults, ensureDefaultEmailTemplates, sendEnrollmentDocumentsEmail, sendTemplatedEmail } from './email.js'
import { getPrivateFilePath, renderCertificate, saveCertificateTemplate, saveSubmissionAttachment, submissionExtensionByMime } from './certificates.js'
import { createApplicationPdf, createFilledDocument, createFilledDocumentBytes } from './enrollment-documents.js'

const app = express()
const server = http.createServer(app)
const io = new Server(server, { cors: { origin: config.clientUrl, credentials: true } })
let databaseReady = false
const memory = { enrollments: new Map(), newsletter: new Map(), presence: new Map(), users: new Map() }
const certificateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, ['application/pdf', 'image/png', 'image/jpeg'].includes(file.mimetype)),
})

// Avatars are public-facing images (unlike signed PDFs, which stay in private storage), so they're
// written to a dedicated static-served directory and referenced by URL, not by object key.
const avatarUploadsDir = path.resolve(process.cwd(), 'server', 'public-uploads', 'avatars')
const avatarMimeExtension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, Boolean(avatarMimeExtension[file.mimetype])),
})
async function saveAvatarUpload(file) {
  await fs.mkdir(avatarUploadsDir, { recursive: true })
  const filename = `${crypto.randomUUID()}.${avatarMimeExtension[file.mimetype]}`
  await fs.writeFile(path.join(avatarUploadsDir, filename), file.buffer)
  return `/uploads/avatars/${filename}`
}

// Course banners follow the same public-static pattern as avatars.
const bannerUploadsDir = path.resolve(process.cwd(), 'server', 'public-uploads', 'banners')
const bannerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, Boolean(avatarMimeExtension[file.mimetype])),
})
async function saveBannerUpload(file) {
  await fs.mkdir(bannerUploadsDir, { recursive: true })
  const filename = `${crypto.randomUUID()}.${avatarMimeExtension[file.mimetype]}`
  await fs.writeFile(path.join(bannerUploadsDir, filename), file.buffer)
  return `/uploads/banners/${filename}`
}

// Assignment submission attachments (the "drop box") — private storage, same as certificates.
const submissionUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, Boolean(submissionExtensionByMime[file.mimetype])),
})

app.set('trust proxy', 1)
app.use(helmet({ crossOriginResourcePolicy: false }))
// In production, lock CORS to the configured client origin. In development, reflect any localhost
// origin so the flow keeps working when Vite falls back to an alternate port (e.g. 5174).
const corsOrigin = isProduction
  ? config.clientUrl
  : (origin, callback) => callback(null, !origin || /^https?:\/\/localhost(:\d+)?$/.test(origin) || /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin))
app.use(cors({ origin: corsOrigin, credentials: true }))
app.use(cookieParser())
app.use(express.json({ limit: '1mb', verify: (req, _res, buffer) => { req.rawBody = buffer } }))
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 250, standardHeaders: 'draft-8', legacyHeaders: false }))
app.use('/uploads/avatars', express.static(path.resolve(process.cwd(), 'server', 'public-uploads', 'avatars'), { maxAge: '7d' }))
app.use('/uploads/banners', express.static(path.resolve(process.cwd(), 'server', 'public-uploads', 'banners'), { maxAge: '7d' }))

const enrollmentInput = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().email().max(254),
  phone: z.string().trim().max(30).optional(),
  pathway: z.enum(['broker', 'consultant', 'agent']),
})
const pricingSettingsInput = z.object({
  totalBroker: z.coerce.number().min(1).max(1_000_000),
  totalConsultant: z.coerce.number().min(1).max(1_000_000),
  totalAgent: z.coerce.number().min(1).max(1_000_000),
  upfrontBroker: z.coerce.number().min(1).max(1_000_000),
  upfrontConsultant: z.coerce.number().min(1).max(1_000_000),
  upfrontAgent: z.coerce.number().min(1).max(1_000_000),
})
// TODO(remove before launch): 'test' is a temporary ₱1 plan for exercising the real PayMongo
// checkout → webhook → auto-provisioning path end-to-end without charging the real price. Remove
// this enum value, the TEST_PLAN_AMOUNT branch below, and the matching option in
// src/components/enrollment/PaymentStep.jsx once testing is done.
const paymentSessionInput = z.object({ plan: z.enum(['full', 'upfront', 'test']).optional() })
const TEST_PLAN_AMOUNT = 1

// Falls back to catalog.js's static price when no admin override has been saved yet (or when
// running without MongoDB), so the enrollment/payment flow always has a price to show.
async function getPricingSettings() {
  const defaults = { totalBroker: catalog.product.amount, totalConsultant: catalog.product.amount, totalAgent: catalog.product.amount, currency: catalog.product.currency, upfrontBroker: 1000, upfrontConsultant: 5000, upfrontAgent: 1000 }
  if (!databaseReady) return defaults
  const saved = await PricingSettings.findOne().lean()
  return saved ? { totalBroker: saved.totalBroker, totalConsultant: saved.totalConsultant, totalAgent: saved.totalAgent, currency: saved.currency, upfrontBroker: saved.upfrontBroker, upfrontConsultant: saved.upfrontConsultant, upfrontAgent: saved.upfrontAgent } : defaults
}
const totalAmountKeyByPathway = { broker: 'totalBroker', consultant: 'totalConsultant', agent: 'totalAgent' }
const upfrontAmountKeyByPathway = { broker: 'upfrontBroker', consultant: 'upfrontConsultant', agent: 'upfrontAgent' }
const totalAmountForPathway = (pricing, pathway) => pricing[totalAmountKeyByPathway[pathway]]
const upfrontAmountForPathway = (pricing, pathway) => pricing[upfrontAmountKeyByPathway[pathway]]
const requiredApplicationText = (label, max = 500) => z.string().trim().min(1, `${label} is required.`).max(max)
const requiredAcknowledgement = z.boolean().refine((value) => value, 'This acknowledgment is required.')
const applicationInput = z.object({
  full_name: requiredApplicationText('Full legal name', 100),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date of birth.'),
  mobile: requiredApplicationText('Mobile number', 30),
  email: z.string().trim().email('Enter a valid email address.').max(254),
  address: requiredApplicationText('Complete address', 500),
  emergency_name: requiredApplicationText('Emergency contact name', 100),
  emergency_mobile: requiredApplicationText('Emergency contact number', 30),
  school: requiredApplicationText('School or university', 200),
  degree: requiredApplicationText('Degree completed', 200),
  grad_year: z.coerce.number().int().min(1950).max(2035),
  attempts: requiredApplicationText('Previous REBLEX attempts', 100),
  prc_status: requiredApplicationText('PRC application status', 100),
  computation_level: requiredApplicationText('Computation comfort', 100),
  situational_level: requiredApplicationText('Situational-question comfort', 100),
  study_hours: requiredApplicationText('Weekly study time', 100),
  internet: requiredApplicationText('Internet access', 100),
  device: requiredApplicationText('Primary device', 100),
  commit_attend: requiredAcknowledgement,
  commit_study: requiredAcknowledgement,
  commit_assess: requiredAcknowledgement,
  commit_remediate: requiredAcknowledgement,
  commit_communicate: requiredAcknowledgement,
  agree_nonsharing: requiredAcknowledgement,
  agree_integrity: requiredAcknowledgement,
  agree_privacy: requiredAcknowledgement,
  agree_recording: requiredAcknowledgement,
}).passthrough()
const signatureInput = z.object({
  signatureName: z.string().trim().min(2, 'Please type your full legal name.').max(100),
  signatureDataUrl: z.string().max(300000).regex(/^data:image\/png;base64,[a-z0-9+/=]+$/i, 'Please provide a valid signature.'),
  consent: z.literal(true, { error: 'Electronic-signature consent is required.' }),
})
const realexReblexInput = z.object({
  exam_type: z.enum(['REBLEX', 'REALEX']),
  p_name: requiredApplicationText('Participant name', 100),
  p_address: requiredApplicationText('Address', 500),
  p_contact: requiredApplicationText('Contact number', 30),
  p_email: z.string().trim().email('Enter a valid email address.'),
  p_prc_app: requiredApplicationText('PRC application status', 300),
  p_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.'),
  prov_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.'),
})
const reclexInput = z.object({
  agmt_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the agreement date.'),
  agmt_place: requiredApplicationText('Agreement place', 150),
  r_name: requiredApplicationText('Registrant name', 100),
  r_lic_type: requiredApplicationText('License type', 100),
  r_lic_no: requiredApplicationText('License number', 100),
  r_contact: requiredApplicationText('Contact number', 30),
  r_email: z.string().trim().email('Enter a valid email address.'),
  r_address: requiredApplicationText('Address', 500),
  r_target_exam: requiredApplicationText('Target examination', 100),
  a_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the acknowledgment date.'),
  b_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the signature date.'),
  agmt_no: z.string().trim().max(100).optional(),
  w1_name: z.string().trim().max(100).optional(),
  w2_name: z.string().trim().max(100).optional(),
})
const newsletterInput = z.object({ email: z.string().email().max(254) })
// Login must accept any stored password and let bcrypt decide — the 10-char minimum is an
// account-creation policy, not a sign-in gate. Enforcing it here just turns a wrong password
// into a confusing "check the highlighted fields" 422 instead of "email or password is incorrect".
const loginInput = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) })
// Activation identifies the account by the setup token alone (POST /api/auth/activate looks the
// user up via inviteTokenHash) — no email field, since the client has no reason to send one.
const activationInput = z.object({ token: z.string().min(20).max(200), password: z.string().min(10).max(128) })
const profileInput = z.object({ bio: z.string().trim().max(600).optional(), headline: z.string().trim().max(120).optional(), location: z.string().trim().max(120).optional() })
const passwordChangeInput = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(10).max(128) })
const badgeInput = z.object({ title: z.string().trim().min(2).max(120), description: z.string().trim().max(400).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), icon: z.string().trim().max(40).optional() })
const awardInput = z.object({ learnerId: z.string().min(1), note: z.string().trim().max(400).optional() })
const certificateIssueInput = z.object({ templateId: z.string().min(1), learnerId: z.string().min(1) })
const certificateTemplateInput = z.object({ title: z.string().trim().min(2).max(160), scope: z.enum(['module', 'program']), targetId: z.string().min(1), nameX: z.coerce.number().min(0).max(2000).optional(), nameY: z.coerce.number().min(0).max(2000).optional(), nameSize: z.coerce.number().min(10).max(120).optional() })

const courseInput = z.object({
  title: z.string().trim().min(2).max(160),
  slug: z.string().trim().min(2).max(160).regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers, and hyphens only.'),
  programId: z.string().trim().min(1).optional(),
  description: z.string().trim().max(2000).optional(),
  isPublished: z.boolean().optional(),
  availableFrom: z.coerce.date().nullable().optional(),
  availableUntil: z.coerce.date().nullable().optional(),
  bannerPreset: z.string().trim().max(60).nullable().optional(),
})
const courseUpdateInput = courseInput.partial()
const moduleInput = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  phaseNumber: z.coerce.number().int().min(1).max(99).nullable().optional(),
  position: z.coerce.number().int().min(0),
  isPublished: z.boolean().optional(),
})
const moduleUpdateInput = moduleInput.partial()
const lessonInput = z.object({
  title: z.string().trim().min(2).max(160),
  kind: z.enum(['article', 'video', 'document', 'link', 'header']).optional(),
  body: z.string().trim().max(20000).optional(),
  resourceKey: z.string().trim().max(500).optional(),
  driveUrl: z.string().trim().url().max(500).nullable().optional(),
  position: z.coerce.number().int().min(0),
  isPublished: z.boolean().optional(),
})
const lessonUpdateInput = lessonInput.partial()
const assignmentInput = z.object({
  title: z.string().trim().min(2).max(160),
  moduleId: z.string().trim().min(1),
  lessonId: z.string().trim().min(1).nullable().optional(),
  instructions: z.string().trim().max(20000).optional(),
  instructionsUrl: z.string().trim().url().max(500).nullable().optional(),
  dueAt: z.coerce.date().optional(),
  maxPoints: z.coerce.number().min(1).max(1000).optional(),
  submissionType: z.enum(['text', 'file', 'both']).optional(),
  position: z.coerce.number().int().min(0).optional(),
})
const assignmentUpdateInput = assignmentInput.partial()
const gradeInput = z.object({
  grade: z.coerce.number().min(0).max(1000),
  feedback: z.string().trim().max(2000).optional(),
})
const submissionCommentInput = z.object({ body: z.string().trim().min(1).max(4000) })
const choicesQuestionInput = z.object({
  type: z.enum(['multiple_choice', 'true_false']),
  prompt: z.string().trim().min(2).max(10000),
  choices: z.array(z.string().trim().min(1).max(300)).min(2).max(6),
  answerIndex: z.coerce.number().int().min(0),
  explanation: z.string().trim().max(10000).optional(),
}).refine((value) => value.answerIndex < value.choices.length, { message: 'answerIndex must reference one of the choices.' })
const fillBlankQuestionInput = z.object({
  type: z.literal('fill_blank'),
  prompt: z.string().trim().min(2).max(10000),
  acceptableAnswers: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  explanation: z.string().trim().max(10000).optional(),
})
const essayQuestionInput = z.object({
  type: z.literal('essay'),
  prompt: z.string().trim().min(2).max(10000),
  explanation: z.string().trim().max(10000).optional(),
})
const matchingQuestionInput = z.object({
  type: z.literal('matching'),
  prompt: z.string().trim().min(2).max(10000),
  pairs: z.array(z.object({ left: z.string().trim().min(1).max(200), right: z.string().trim().min(1).max(200) })).min(2).max(12),
  explanation: z.string().trim().max(10000).optional(),
})
const enumerationQuestionInput = z.object({
  type: z.literal('enumeration'),
  prompt: z.string().trim().min(2).max(10000),
  acceptableAnswers: z.array(z.string().trim().min(1).max(200)).min(1).max(30),
  minAnswers: z.coerce.number().int().min(1).max(30),
  explanation: z.string().trim().max(10000).optional(),
}).refine((value) => value.minAnswers <= value.acceptableAnswers.length, { message: 'minAnswers cannot exceed the number of acceptable answers.' })
const quizQuestionInput = z.discriminatedUnion('type', [choicesQuestionInput, fillBlankQuestionInput, essayQuestionInput, matchingQuestionInput, enumerationQuestionInput])
const quizInput = z.object({
  title: z.string().trim().min(2).max(160),
  moduleId: z.string().trim().min(1).nullable().optional(),
  position: z.coerce.number().int().min(0).optional(),
  questions: z.array(quizQuestionInput).min(1).max(50),
  isPublished: z.boolean().optional(),
})
const quizUpdateInput = quizInput.partial()
// Answer shape depends on the question's type (number for multiple_choice/true_false, string for
// fill_blank/essay, string array for enumeration, object for matching) — validated per-question
// against the quiz at grading time instead of a single fixed shape here.
const quizAttemptInput = z.object({ answers: z.array(z.any()).min(1) })
const calendarEventInput = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  eventType: z.enum(['live_review', 'deadline', 'announcement', 'office_hours']).optional(),
  courseId: z.string().trim().min(1).optional(),
})
const attendanceInput = z.object({
  records: z.array(z.object({ learnerId: z.string().trim().min(1), status: z.enum(['present', 'absent', 'excused', 'late']) })).min(1).max(500),
})
const announcementInput = z.object({
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().min(2).max(4000),
  pinned: z.boolean().optional(),
})
const forumThreadInput = z.object({
  courseId: z.string().trim().min(1),
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().min(2).max(6000),
})
const forumPostInput = z.object({ body: z.string().trim().min(1).max(6000) })
const forumModerateInput = z.object({ isPinned: z.boolean().optional(), isLocked: z.boolean().optional() })
const notificationBroadcastInput = z.object({
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().max(2000).optional(),
  link: z.string().trim().max(300).optional(),
  audience: z.enum(['all_learners', 'all_staff', 'everyone']).optional(),
  recipientIds: z.array(z.string().trim().min(1)).optional(),
})

const usernameField = z.string().trim().toLowerCase().min(3).max(30).regex(/^[a-z0-9._-]+$/, 'Usernames use letters, numbers, dot, underscore, or hyphen.')
const adminUserCreateInput = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  username: usernameField.optional(),
  role: z.enum(['learner', 'instructor', 'admin']).optional(),
  courseIds: z.array(z.string().trim().min(1)).max(100).optional(),
})
const categoryInput = z.object({ title: z.string().trim().min(2).max(160), description: z.string().trim().max(2000).optional(), bannerPreset: z.string().trim().max(60).optional(), bannerUrl: z.string().trim().url().max(1000).optional(), position: z.coerce.number().int().min(0) })
const categoryUpdateInput = categoryInput.partial().extend({ status: z.enum(['draft', 'published', 'archived']).optional() })
const categoryHeaderInput = z.object({ title: z.string().trim().min(2).max(160), position: z.coerce.number().int().min(0) })
const learningModuleInput = z.object({ type: z.enum(['file', 'quiz', 'assignment']), title: z.string().trim().min(2).max(160), instructions: z.string().trim().max(5000).optional(), resourceUrl: z.string().trim().url().max(1000).optional(), position: z.coerce.number().int().min(0), quiz: z.object({ questions: z.array(z.object({ prompt: z.string().trim().min(2).max(1000), choices: z.array(z.string().trim().min(1).max(300)).min(2).max(6), answerIndex: z.coerce.number().int().min(0) })).max(50).optional(), passingScore: z.coerce.number().min(0).max(100).optional() }).optional(), assignment: z.object({ maxPoints: z.coerce.number().min(1).max(1000).optional(), rubric: z.string().trim().max(5000).optional(), feedbackTemplate: z.string().trim().max(2000).optional() }).optional() })
const learningModuleUpdateInput = learningModuleInput.partial().extend({ status: z.enum(['draft', 'published', 'archived']).optional() })
const adminUserUpdateInput = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().email().max(254).optional(),
  username: usernameField.nullable().optional(),
  // Uploaded avatars use API-relative paths; admins may also provide an absolute image URL.
  avatarUrl: z.string().trim().max(500).refine((value) => value.startsWith('/uploads/avatars/') || /^https?:\/\//.test(value), 'Use an uploaded avatar or an http(s) image URL.').nullable().optional(),
  role: z.enum(['learner', 'instructor', 'admin']).optional(),
  status: z.enum(['invited', 'active', 'inactive', 'suspended']).optional(),
  mustChangePassword: z.boolean().optional(),
})
const adminPasswordInput = z.object({ password: z.string().min(10).max(128) })
const bulkUserActionInput = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(200),
  action: z.enum(['activate', 'deactivate', 'suspend', 'delete']),
})
const bulkEnrollInput = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(200),
  courseId: z.string().trim().min(1),
})
const userImportInput = z.object({
  rows: z.array(z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().email().max(254),
    role: z.enum(['learner', 'instructor', 'admin']).optional(),
  })).min(1).max(500),
})
const adminCourseInput = z.object({
  isPublished: z.boolean().optional(),
  archived: z.boolean().optional(),
  availableFrom: z.coerce.date().nullable().optional(),
  availableUntil: z.coerce.date().nullable().optional(),
  showEnrollmentCount: z.boolean().optional(),
})
const courseReviewInput = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(2000).optional() })
const webinarInput = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional(),
  startsAt: z.coerce.date(),
  registrationDeadline: z.coerce.date().nullable().optional(),
  capacity: z.coerce.number().int().min(1).nullable().optional(),
  isPublished: z.boolean().optional(),
})
const webinarUpdateInput = webinarInput.partial()
const webinarRegisterInput = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(254) })
const emailTemplateUpdateInput = z.object({
  subject: z.string().trim().min(2).max(200).optional(),
  body: z.string().trim().min(2).max(20000).optional(),
  fromName: z.string().trim().max(100).optional(),
  fromEmail: z.string().trim().max(254).refine((value) => value === '' || z.string().email().safeParse(value).success, 'Invalid email address').optional(),
  enabled: z.boolean().optional(),
})
const permissionsInput = z.object({
  learner: z.array(z.string().trim().max(60)).max(60),
  instructor: z.array(z.string().trim().max(60)).max(60),
  admin: z.array(z.string().trim().max(60)).max(60),
})
const contentAssetInput = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).optional(),
  category: z.enum(['template', 'document', 'video', 'image', 'link', 'other']).optional(),
  url: z.string().trim().max(1000).optional(),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
})
const supportTicketInput = z.object({
  subject: z.string().trim().min(2).max(160),
  category: z.enum(['account', 'billing', 'technical', 'course', 'other']).optional(),
  message: z.string().trim().min(2).max(4000),
})
const supportUpdateInput = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  response: z.string().trim().max(4000).optional(),
})
const reportInput = z.object({
  type: z.enum(['progress', 'issue', 'feedback', 'incident', 'other']).optional(),
  title: z.string().trim().min(2).max(160),
  details: z.string().trim().min(2).max(4000),
})
const reportUpdateInput = z.object({
  status: z.enum(['submitted', 'reviewing', 'actioned', 'dismissed']).optional(),
  reviewNote: z.string().trim().max(2000).optional(),
})
const bulkDecisionInput = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(100),
  decision: z.enum(['approved', 'rejected', 'refunded']),
  reason: z.string().trim().max(500).optional(),
})

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

// Seasonal availability — published courses are only visible to learners/public inside their window.
const learnerCourseFilter = () => {
  const now = new Date()
  return {
    isPublished: true,
    $and: [
      { $or: [{ availableFrom: { $exists: false } }, { availableFrom: null }, { availableFrom: { $lte: now } }] },
      { $or: [{ availableUntil: { $exists: false } }, { availableUntil: null }, { availableUntil: { $gte: now } }] },
    ],
  }
}
const courseIsAvailable = (course) => {
  const now = Date.now()
  if (course.availableFrom && new Date(course.availableFrom).getTime() > now) return false
  if (course.availableUntil && new Date(course.availableUntil).getTime() < now) return false
  return true
}
// A learner only sees the course tied to the pathway on their approved enrollment — granted via a
// LearningProgress row created at approval time (see provisionLearnerAccount) — not every course.
async function learnerVisibleCourseFilter(learnerId) {
  const rows = await LearningProgress.find({ learnerId }).select('courseId').lean()
  return { ...learnerCourseFilter(), _id: { $in: rows.map((row) => row.courseId) } }
}
const courseForPathway = (pathway) => Course.findOne({ slug: `${pathway}-review` })
const id = () => crypto.randomUUID()
const publicEnrollment = (enrollment) => ({ id: enrollment._id?.toString() ?? enrollment.id, status: enrollment.status, amount: enrollment.amount, currency: enrollment.currency })

async function findEnrollment(enrollmentId) {
  if (databaseReady) return Enrollment.findById(enrollmentId)
  return memory.enrollments.get(enrollmentId)
}

// Notification/receipt emails must never fail the request that triggered them (account creation,
// document signing, payment confirmation) — the underlying record is already saved by the time we
// send. A rejected/misconfigured email provider should only affect delivery, never the operation.
async function bestEffortEmail(promise, label) {
  try {
    return await promise
  } catch (error) {
    console.error(`${label} failed:`, error.message)
    return { delivery: 'failed' }
  }
}

const ACCOUNT_SETUP_WINDOW_MS = 72 * 60 * 60 * 1000

// Issues a one-time setup link (instead of emailing a plaintext temp password) so a newly
// provisioned learner sets their own password on first login — consumed by POST /api/auth/activate.
async function issueAccountSetupUrl(user) {
  const token = createToken()
  user.inviteTokenHash = hashToken(token)
  user.inviteExpiresAt = new Date(Date.now() + ACCOUNT_SETUP_WINDOW_MS)
  await user.save()
  return `${config.clientUrl}/auth?mode=activate&token=${token}`
}

// Admin-customizable via the "enrollment_credentials" template (Settings > Email Automation) —
// used whenever a learner account is created: on payment confirmation (see markEnrollmentPaid) and
// when staff create/import a user directly. setupUrl is null for an already-active account (no
// first-time setup needed) — sendPaymentReceiptEmail falls back to the plain login page in that case.
const sendCredentialsEmail = ({ name, email, setupUrl }) => sendTemplatedEmail('enrollment_credentials', email, { name, email, setupUrl: setupUrl ?? `${config.clientUrl}/auth`, loginUrl: `${config.clientUrl}/auth` })

const pathwayTitleById = new Map(catalog.pathways.map((pathway) => [pathway.id, pathway.title]))
const planLabel = { full: 'Full payment', upfront: 'Upfront reservation fee', test: 'Test charge' }

// Admin-customizable via the "payment_receipt" template — sent alongside the credentials email
// whenever a payment is confirmed (markEnrollmentPaid and the staff-decision fallback routes), so
// the applicant has a record of exactly what was charged even on the "pay upfront only" plan.
function sendPaymentReceiptEmail(enrollment, setupUrl) {
  const payment = enrollment.payment ?? {}
  const totalAmount = Number(enrollment.amount ?? 0)
  const planAmount = Number(payment.planAmount ?? totalAmount)
  const balanceDue = Math.max(0, totalAmount - planAmount)
  const peso = (value) => `₱${value.toLocaleString('en-PH')}`
  return sendTemplatedEmail('payment_receipt', enrollment.applicant.email, {
    name: enrollment.applicant.name,
    email: enrollment.applicant.email,
    pathway: pathwayTitleById.get(enrollment.applicant.pathway) ?? enrollment.applicant.pathway,
    planLabel: planLabel[payment.plan] ?? 'Payment',
    amountPaid: peso(planAmount),
    totalAmount: peso(totalAmount),
    balanceDue: peso(balanceDue),
    referenceNumber: payment.referenceNumber ?? enrollment._id?.toString() ?? enrollment.id,
    transactionId: payment.transactionId ?? '—',
    paidAt: (payment.paidAt ? new Date(payment.paidAt) : new Date()).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }),
    // First-time accounts link straight to the password-setup page instead of a bare login form.
    loginUrl: setupUrl ?? `${config.clientUrl}/auth`,
  })
}

async function provisionLearnerAccount(enrollment) {
  const applicant = enrollment.applicant
  if (!databaseReady) {
    memory.users.set(applicant.email, { name: applicant.name, email: applicant.email, status: 'active', role: 'learner' })
    return { delivery: 'demo_preview', setupUrl: null }
  }
  let learner = await User.findOne({ email: applicant.email })
  if (!learner) learner = new User({ name: applicant.name, email: applicant.email, role: 'learner' })
  const alreadyActive = learner.status === 'active'
  let setupUrl = null
  if (!alreadyActive) {
    learner.status = 'active'
    setupUrl = await issueAccountSetupUrl(learner)
  }
  // Grant access to the course tied to the pathway just approved — a returning learner approved
  // for a second pathway gains that course too, without losing access to their first.
  const pathwayCourse = await courseForPathway(applicant.pathway)
  if (pathwayCourse) await LearningProgress.findOneAndUpdate(
    { learnerId: learner._id, courseId: pathwayCourse._id }, { $setOnInsert: { completedModuleIds: [] } }, { upsert: true, setDefaultsOnInsert: true })
  if (alreadyActive) return { delivery: 'existing_active_account', setupUrl: null }
  const delivery = await bestEffortEmail(sendCredentialsEmail({ name: learner.name, email: learner.email, setupUrl }), 'enrollment_credentials email')
  return { ...delivery, setupUrl }
}

// Shared by the real PayMongo webhook and the dev-only demo/mark-paid shortcut. Payment
// confirmation now provisions the learner account immediately — no staff review step — but only
// from here, which only ever runs after PayMongo's signature-verified webhook (or, in demo mode,
// an explicit dev action) confirms funds; a browser redirect alone still never grants access.
async function markEnrollmentPaid(enrollment, paymentPatch) {
  const wasAwaitingPayment = ['payment_pending', 'contract_signed'].includes(enrollment.status)
  if (wasAwaitingPayment) {
    enrollment.status = 'approved'
    enrollment.decisionReason = 'Auto-approved on payment confirmation.'
    enrollment.reviewedAt = new Date()
  }
  enrollment.payment = { ...(enrollment.payment?.toObject?.() ?? enrollment.payment ?? {}), ...paymentPatch }
  if (databaseReady) await enrollment.save()
  if (!wasAwaitingPayment) return null
  const invitation = await provisionLearnerAccount(enrollment)
  await bestEffortEmail(sendPaymentReceiptEmail(enrollment, invitation?.setupUrl), 'payment_receipt email')
  return invitation
}

function paymentReturnUrl(state, enrollmentId) {
  const url = new URL('/enroll', config.clientUrl)
  url.searchParams.set('payment', state)
  url.searchParams.set('enrollment', enrollmentId)
  return url.toString()
}

function refreshCookie(res, token) {
  res.cookie('treeacademy_refresh', token, { httpOnly: true, secure: isProduction, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 14, path: '/api/auth' })
}

async function issueSession(res, user, impersonatorId = null) {
  const refreshToken = createToken()
  await RefreshToken.create({ userId: user._id, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14), impersonatorId })
  refreshCookie(res, refreshToken)
  return signAccessToken(user)
}

const sessionUser = (user, extra = {}) => ({ id: user.id, name: user.name, email: user.email, role: user.role, avatarUrl: user.avatarUrl, ...extra })

async function saveAudit(action, entityType, entityId, metadata = {}, actorId) {
  if (databaseReady) await AuditLog.create({ action, entityType, entityId, metadata, actorId })
}

async function notifyUsers(recipientIds, { title, body, link }) {
  const ids = recipientIds.filter(Boolean)
  if (!databaseReady || !ids.length) return
  await Notification.insertMany(ids.map((recipientId) => ({ recipientId, title, body, link })))
}

async function issueCertificate({ template, learner, issuedBy }) {
  const existing = await Certificate.findOne({ templateId: template._id, learnerId: learner._id })
  if (existing) return existing
  const fileKey = await renderCertificate(template, learner)
  const certificate = await Certificate.create({ templateId: template._id, learnerId: learner._id, recipientName: learner.name, targetId: template.targetId, fileKey, issuedBy })
  await saveAudit('certificate.issued', 'Certificate', certificate.id, { templateId: template.id, learnerId: learner.id }, issuedBy)
  return certificate
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: databaseReady ? 'connected' : 'demo-memory', integrations }))
app.get('/api/catalog', (_req, res) => res.json(catalog))

// Live pathway stats for the existing "Three pathways" landing section — seed data maps one
// Course per pathway via slug `${pathwayId}-review` (see seed-content.js), so that's the join key.
// Folds enrollment counts + seasonal availability into the pathway cards already on the page,
// rather than a separate catalog section.
app.get('/api/public/pathway-stats', asyncRoute(async (_req, res) => {
  if (!databaseReady) return res.json({})
  const now = new Date()
  const courses = await Course.find({ slug: { $in: ['broker-review', 'consultant-review', 'agent-review'] } })
    .select('slug isPublished archivedAt availableFrom availableUntil showEnrollmentCount').lean()
  const enrollCounts = await LearningProgress.aggregate([
    { $match: { courseId: { $in: courses.map((course) => course._id) } } },
    { $group: { _id: '$courseId', count: { $sum: 1 } } },
  ])
  const enrollMap = new Map(enrollCounts.map((row) => [String(row._id), row.count]))
  const stats = {}
  for (const course of courses) {
    const pathwayId = course.slug.replace(/-review$/, '')
    const isOpen = course.isPublished && !course.archivedAt
    stats[pathwayId] = {
      enrolledCount: course.showEnrollmentCount !== false ? (enrollMap.get(String(course._id)) ?? 0) : null,
      availableFrom: course.availableFrom ?? null,
      availableUntil: course.availableUntil ?? null,
      opensLater: Boolean(isOpen && course.availableFrom && new Date(course.availableFrom) > now),
      closed: !isOpen || Boolean(course.availableUntil && new Date(course.availableUntil) < now),
    }
  }
  res.json(stats)
}))

// Special courses / webinars — visible only while open: published, before the registration
// deadline (or start time if none set), and under capacity. They disappear from the public list
// automatically once any of those conditions trips, no admin action required.
function visibleWebinarFilter() {
  return { isPublished: true, $expr: { $gte: [{ $ifNull: ['$registrationDeadline', '$startsAt'] }, new Date()] } }
}

app.get('/api/public/webinars', asyncRoute(async (_req, res) => {
  if (!databaseReady) return res.json([])
  const webinars = await Webinar.find(visibleWebinarFilter()).sort({ startsAt: 1 }).lean()
  const counts = await WebinarRegistration.aggregate([
    { $match: { webinarId: { $in: webinars.map((webinar) => webinar._id) } } },
    { $group: { _id: '$webinarId', count: { $sum: 1 } } },
  ])
  const countById = new Map(counts.map((row) => [String(row._id), row.count]))
  res.json(webinars
    .map((webinar) => ({
      id: webinar._id.toString(), title: webinar.title, description: webinar.description ?? '',
      startsAt: webinar.startsAt, registrationDeadline: webinar.registrationDeadline ?? null,
      capacity: webinar.capacity ?? null, registeredCount: countById.get(String(webinar._id)) ?? 0,
    }))
    .filter((webinar) => webinar.capacity == null || webinar.registeredCount < webinar.capacity))
}))

app.post('/api/public/webinars/:id/register', asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Registration requires MongoDB.' })
  const webinar = await Webinar.findOne({ _id: req.params.id, ...visibleWebinarFilter() })
  if (!webinar) return res.status(404).json({ error: 'This webinar is no longer accepting registrations.' })
  if (webinar.capacity != null) {
    const registeredCount = await WebinarRegistration.countDocuments({ webinarId: webinar._id })
    if (registeredCount >= webinar.capacity) return res.status(409).json({ error: 'This webinar is full.' })
  }
  const values = webinarRegisterInput.parse(req.body)
  try {
    await WebinarRegistration.create({ webinarId: webinar._id, name: values.name, email: values.email.toLowerCase() })
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'You are already registered for this webinar.' })
    throw error
  }
  sendTemplatedEmail('webinar_registration', values.email, { name: values.name, webinarTitle: webinar.title, webinarDate: new Date(webinar.startsAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) })
    .catch((emailError) => console.error('webinar_registration email failed:', emailError.message))
  await saveAudit('webinar.registered', 'Webinar', webinar.id, { email: values.email })
  res.status(201).json({ registered: true })
}))

app.post('/api/auth/activate', asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Account activation requires MongoDB.' })
  const { token, password } = activationInput.parse(req.body)
  const user = await User.findOne({ inviteTokenHash: hashToken(token), inviteExpiresAt: { $gt: new Date() } })
  if (!user) return res.status(400).json({ error: 'This account-setup link is invalid or expired.' })
  user.passwordHash = await bcrypt.hash(password, 12)
  user.status = 'active'
  user.inviteTokenHash = undefined
  user.inviteExpiresAt = undefined
  await user.save()
  const accessToken = await issueSession(res, user)
  await saveAudit('user.activated', 'User', user.id)
  res.status(201).json({ accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role } })
}))

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Sign-in requires MongoDB.' })
  const { email, password } = loginInput.parse(req.body)
  const user = await User.findOne({ email: email.toLowerCase() })
  if (!user || user.status !== 'active' || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect.' })
  user.lastSeenAt = new Date()
  await user.save()
  const accessToken = await issueSession(res, user)
  res.json({ accessToken, user: sessionUser(user) })
}))

app.post('/api/auth/refresh', asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Session refresh requires MongoDB.' })
  const token = req.cookies.treeacademy_refresh
  if (!token) return res.status(401).json({ error: 'Refresh token required.' })
  const record = await RefreshToken.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } })
  if (!record) return res.status(401).json({ error: 'Refresh token is invalid or expired.' })
  const user = await User.findById(record.userId)
  await RefreshToken.deleteOne({ _id: record._id })
  if (!user || user.status !== 'active') return res.status(401).json({ error: 'Account is inactive.' })
  // Preserve an in-progress impersonation across token rotation so the admin stays in the target's view.
  const impersonator = record.impersonatorId ? await User.findById(record.impersonatorId).select('name role') : null
  const accessToken = await issueSession(res, user, impersonator?._id ?? null)
  res.json({ accessToken, user: sessionUser(user, impersonator ? { impersonating: true, impersonatorName: impersonator.name } : {}) })
}))

app.post('/api/auth/logout', asyncRoute(async (req, res) => {
  if (databaseReady && req.cookies.treeacademy_refresh) await RefreshToken.deleteOne({ tokenHash: hashToken(req.cookies.treeacademy_refresh) })
  res.clearCookie('treeacademy_refresh', { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/api/auth' })
  res.status(204).end()
}))

app.post('/api/auth/stop-impersonation', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Impersonation requires MongoDB.' })
  const token = req.cookies.treeacademy_refresh
  const record = token ? await RefreshToken.findOne({ tokenHash: hashToken(token) }) : null
  if (!record?.impersonatorId) return res.status(400).json({ error: 'This session is not an impersonation.' })
  const admin = await User.findOne({ _id: record.impersonatorId, status: 'active' })
  if (!admin) return res.status(403).json({ error: 'The original account is no longer available.' })
  await RefreshToken.deleteOne({ _id: record._id })
  const accessToken = await issueSession(res, admin)
  await saveAudit('user.impersonation_ended', 'User', record.userId.toString(), {}, admin.id)
  res.json({ accessToken, user: sessionUser(admin) })
}))

app.post('/api/auth/change-password', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Password changes require MongoDB.' })
  const { currentPassword, newPassword } = passwordChangeInput.parse(req.body)
  const user = await User.findById(req.auth.sub)
  if (!user?.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) return res.status(401).json({ error: 'Your current password is incorrect.' })
  user.passwordHash = await bcrypt.hash(newPassword, 12)
  await user.save()
  await RefreshToken.deleteMany({ userId: user._id })
  await saveAudit('user.password_changed', 'User', user.id, {}, user.id)
  res.clearCookie('treeacademy_refresh', { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/api/auth' })
  res.status(204).end()
}))

app.get('/api/users/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Profiles require MongoDB.' })
  const user = await User.findById(req.params.id).select('name email role avatarUrl bio headline location createdAt').lean()
  if (!user) return res.status(404).json({ error: 'User not found.' })
  const badges = await StudentBadge.find({ learnerId: user._id }).populate('badgeId', 'title description color icon').sort({ createdAt: -1 }).lean()
  const certificates = await Certificate.find({ learnerId: user._id }).populate('templateId', 'title scope').sort({ createdAt: -1 }).lean()
  res.json({ user, badges, certificates })
}))

app.patch('/api/users/me', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Profile updates require MongoDB.' })
  const updates = profileInput.parse(req.body)
  const user = await User.findByIdAndUpdate(req.auth.sub, updates, { new: true }).select('name email role avatarUrl bio headline location createdAt')
  if (!user) return res.status(404).json({ error: 'User not found.' })
  await saveAudit('user.profile_updated', 'User', user.id, {}, user.id)
  res.json(user)
}))

app.post('/api/users/me/avatar', requireAuth, avatarUpload.single('avatar'), asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Avatar uploads require MongoDB.' })
  if (!req.file) return res.status(400).json({ error: 'Choose a JPG, PNG, or WEBP image under 3MB.' })
  const avatarUrl = await saveAvatarUpload(req.file)
  const user = await User.findByIdAndUpdate(req.auth.sub, { avatarUrl }, { new: true })
  await saveAudit('user.avatar_updated', 'User', user.id, {}, user.id)
  res.json({ avatarUrl, user: sessionUser(user) })
}))

app.get('/api/auth/google', (_req, res) => {
  if (!config.google.clientId || !config.google.clientSecret) return res.status(503).json({ error: 'Google sign-in is not configured.' })
  const state = createToken()
  res.cookie('treeacademy_google_state', state, { httpOnly: true, secure: isProduction, sameSite: 'lax', maxAge: 10 * 60 * 1000, path: '/api/auth/google' })
  const query = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
  })
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${query}`)
})

app.get('/api/auth/google/callback', asyncRoute(async (req, res) => {
  const failure = (reason) => res.redirect(`${config.clientUrl}/auth?oauth=${encodeURIComponent(reason)}`)
  if (!databaseReady || !config.google.clientId || !config.google.clientSecret || !req.query.code || req.query.state !== req.cookies.treeacademy_google_state) return failure('unavailable')
  res.clearCookie('treeacademy_google_state', { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/api/auth/google' })
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: req.query.code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: config.google.redirectUri, grant_type: 'authorization_code' }),
  })
  if (!tokenResponse.ok) return failure('denied')
  const tokens = await tokenResponse.json()
  const identityResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`)
  if (!identityResponse.ok) return failure('identity')
  const identity = await identityResponse.json()
  if (identity.aud !== config.google.clientId || identity.email_verified !== 'true') return failure('identity')
  const user = await User.findOne({ email: identity.email.toLowerCase() })
  if (!user || user.status === 'suspended') return failure('not-approved')
  user.googleSubject = identity.sub
  if (user.status === 'invited') {
    user.status = 'active'
    user.inviteTokenHash = undefined
    user.inviteExpiresAt = undefined
  }
  await user.save()
  await issueSession(res, user)
  await saveAudit('user.google_signed_in', 'User', user.id)
  res.redirect(`${config.clientUrl}/dashboard?oauth=success`)
}))

app.post('/api/newsletter', asyncRoute(async (req, res) => {
  const { email } = newsletterInput.parse(req.body)
  const normalized = email.toLowerCase()

  let shouldSendConfirmation = true
  let createdSubscriber = false
  let reactivatedSubscriber = false

  if (databaseReady) {
    const existingSubscriber = await NewsletterSubscriber.findOne({ email: normalized })
    if (existingSubscriber && existingSubscriber.status !== 'unsubscribed') shouldSendConfirmation = false
    else if (existingSubscriber) {
      reactivatedSubscriber = true
      await NewsletterSubscriber.updateOne({ _id: existingSubscriber._id }, { status: 'pending', consentedAt: new Date() })
    }
    else {
      try {
        await NewsletterSubscriber.create({ email: normalized, status: 'pending', consentedAt: new Date() })
        createdSubscriber = true
      } catch (error) {
        if (error?.code === 11000) shouldSendConfirmation = false
        else throw error
      }
    }
  } else {
    const existingSubscriber = memory.newsletter.get(normalized)
    if (existingSubscriber && existingSubscriber.status !== 'unsubscribed') shouldSendConfirmation = false
    else {
      createdSubscriber = !existingSubscriber
      reactivatedSubscriber = Boolean(existingSubscriber)
      memory.newsletter.set(normalized, { email: normalized, status: 'pending', consentedAt: new Date() })
    }
  }

  if (shouldSendConfirmation) {
    try {
      if (config.newsletter.makeWebhookUrl) {
        const confirmationResponse = await fetch(config.newsletter.makeWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: normalized, source: 'Website Newsletter Form', submittedAt: new Date().toISOString(), status: 'Active' }),
        })
        if (!confirmationResponse.ok) throw new Error(`Newsletter provider rejected confirmation request (${confirmationResponse.status})`)
      }
      await saveAudit('newsletter.confirmation_requested', 'NewsletterSubscriber', normalized)
    } catch (error) {
      if (databaseReady && createdSubscriber) await NewsletterSubscriber.deleteOne({ email: normalized })
      else if (databaseReady && reactivatedSubscriber) await NewsletterSubscriber.updateOne({ email: normalized }, { status: 'unsubscribed' })
      else if (createdSubscriber) memory.newsletter.delete(normalized)
      else if (reactivatedSubscriber) memory.newsletter.set(normalized, { email: normalized, status: 'unsubscribed' })
      throw error
    }
  }

  res.status(shouldSendConfirmation ? 201 : 200).json({
    status: shouldSendConfirmation ? 'pending_confirmation' : 'already_registered',
    message: 'You’re on the list. Please check your inbox.',
  })
}))

app.get('/api/pricing', asyncRoute(async (_req, res) => {
  res.json(await getPricingSettings())
}))

app.patch('/api/admin/pricing', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Pricing settings require MongoDB.' })
  const values = pricingSettingsInput.parse(req.body)
  const settings = await PricingSettings.findOneAndUpdate({}, values, { new: true, upsert: true, setDefaultsOnInsert: true })
  await saveAudit('pricing.updated', 'PricingSettings', settings.id, values, req.auth.sub)
  res.json(settings)
}))

app.post('/api/enrollments', asyncRoute(async (req, res) => {
  const applicant = enrollmentInput.parse(req.body)
  const pricing = await getPricingSettings()
  const enrollmentData = { applicant: { ...applicant, email: applicant.email.toLowerCase() }, amount: totalAmountForPathway(pricing, applicant.pathway), currency: pricing.currency, status: 'application_pending' }
  const enrollment = databaseReady ? await Enrollment.create(enrollmentData) : { ...enrollmentData, id: id() }
  if (!databaseReady) memory.enrollments.set(enrollment.id, enrollment)
  await saveAudit('enrollment.created', 'Enrollment', enrollment._id?.toString() ?? enrollment.id, { pathway: applicant.pathway })
  if (databaseReady) {
    sendTemplatedEmail('enrollment_received', applicant.email, { name: applicant.name, pathway: applicant.pathway, enrollUrl: `${config.clientUrl}/enroll` })
      .catch((emailError) => console.error('enrollment_received email failed:', emailError.message))
  }

  res.status(201).json({ ...publicEnrollment(enrollment), nextStep: 'application' })
}))

app.post('/api/enrollments/:id/application', asyncRoute(async (req, res) => {
  const values = applicationInput.parse(req.body?.data)
  const enrollment = await findEnrollment(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  if (!['application_pending', 'documents_pending'].includes(enrollment.status)) return res.status(409).json({ error: 'This application can no longer be changed.' })
  if (values.email.toLowerCase() !== enrollment.applicant.email) return res.status(422).json({ error: 'The application email must match the enrollment email.' })

  const pdfKey = await createApplicationPdf({ data: values })
  enrollment.applicant.name = values.full_name
  enrollment.applicant.phone = values.mobile
  enrollment.intake = { data: values, submittedAt: new Date(), pdfKey }
  enrollment.status = 'documents_pending'
  if (databaseReady) await enrollment.save()
  await saveAudit('enrollment.application_submitted', 'Enrollment', req.params.id)
  res.json({ ...publicEnrollment(enrollment), nextStep: 'realex-reblex' })
}))

app.post('/api/enrollments/:id/documents/:type', asyncRoute(async (req, res) => {
  const type = req.params.type
  if (!['realex-reblex', 'reclex'].includes(type)) return res.status(404).json({ error: 'Unknown enrollment document.' })
  const { signatureName, signatureDataUrl, consent } = signatureInput.parse(req.body)
  const fields = (type === 'realex-reblex' ? realexReblexInput : reclexInput).parse(req.body.fields)
  const enrollment = await findEnrollment(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  if (!['documents_pending', 'documents_complete', 'payment_pending'].includes(enrollment.status)) return res.status(409).json({ error: 'Complete the application before this document.' })
  if (signatureName.localeCompare(enrollment.applicant.name, undefined, { sensitivity: 'accent' }) !== 0) return res.status(422).json({ error: 'Your typed electronic signature must match the legal name used for enrollment.' })
  if (!consent) return res.status(422).json({ error: 'Electronic-signature consent is required.' })

  const requiredType = enrollment.applicant.pathway === 'consultant' ? 'reclex' : 'realex-reblex'
  if (type !== requiredType) {
    return res.status(409).json({ error: 'This enrollment requires the correct pathway document before payment.' })
  }

  const pdfKey = await createFilledDocument({ type, fields, signatureDataUrl, signatureName })
  const documentName = type === 'realex-reblex' ? 'realexReblex' : 'reclex'
  enrollment.documents ??= {}
  enrollment.documents[documentName] = { pdfKey, signedAt: new Date(), signatureName }
  enrollment.status = 'payment_pending'
  if (databaseReady) await enrollment.save()

  await bestEffortEmail(sendEnrollmentDocumentsEmail({
    enrollmentId: req.params.id,
    applicant: enrollment.applicant,
    documentKeys: [
      { key: enrollment.intake.pdfKey, filename: `PASS-FIRST-Application-${req.params.id}.pdf` },
      { key: pdfKey, filename: type === 'realex-reblex' ? `REALEX-REBLEX-${req.params.id}.pdf` : `RECLEX-${req.params.id}.pdf` },
    ],
  }), 'enrollment documents notification')

  await saveAudit(`enrollment.document_${type}_submitted`, 'Enrollment', req.params.id)
  res.json({ ...publicEnrollment(enrollment), nextStep: 'payment', documentsComplete: true })
}))

app.post('/api/enrollments/:id/documents/:type/download', asyncRoute(async (req, res) => {
  const type = req.params.type
  if (!['realex-reblex', 'reclex'].includes(type)) return res.status(404).json({ error: 'Unknown enrollment document.' })
  const { signatureName, signatureDataUrl, consent } = signatureInput.parse(req.body)
  const fields = (type === 'realex-reblex' ? realexReblexInput : reclexInput).parse(req.body.fields)
  const enrollment = await findEnrollment(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  if (signatureName.localeCompare(enrollment.applicant.name, undefined, { sensitivity: 'accent' }) !== 0) return res.status(422).json({ error: 'Your typed electronic signature must match the legal name used for enrollment.' })
  if (!consent) return res.status(422).json({ error: 'Electronic-signature consent is required.' })

  const pdfBytes = await createFilledDocumentBytes({ type, fields, signatureDataUrl, signatureName })
  const filename = type === 'realex-reblex' ? `REALEX-REBLEX-${req.params.id}.pdf` : `RECLEX-${req.params.id}.pdf`
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(Buffer.from(pdfBytes))
}))

app.post('/api/enrollments/:id/payment-session', asyncRoute(async (req, res) => {
  const enrollment = await findEnrollment(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  if (enrollment.status !== 'payment_pending') return res.status(409).json({ error: 'All signed documents are required before payment.' })

  // "upfront" only charges the pathway's reservation fee now — the remaining balance
  // (enrollment.amount - planAmount) is followed up on manually by staff, see payment.plan/
  // planAmount below and AdminEnrollmentsPage's balance column.
  const { plan } = paymentSessionInput.parse(req.body ?? {})
  const resolvedPlan = plan ?? 'full'
  const pricing = await getPricingSettings()
  const chargeAmount = resolvedPlan === 'test' ? TEST_PLAN_AMOUNT
    : resolvedPlan === 'upfront' ? upfrontAmountForPathway(pricing, enrollment.applicant.pathway)
    : enrollment.amount

  if (!config.paymongo.secretKey) {
    enrollment.payment = { provider: 'paymongo-payment-link', checkoutUrl: config.paymongo.paymentLink, referenceNumber: req.params.id, plan: resolvedPlan, planAmount: chargeAmount }
    if (databaseReady) await enrollment.save()
    return res.json({ checkoutUrl: config.paymongo.paymentLink, mode: 'payment_link_fallback', message: 'The PayMongo payment page is open. Add a PayMongo secret key and webhook to enable automatic payment matching and account email.' })
  }

  const payload = {
    data: {
      attributes: {
        billing: { name: enrollment.applicant.name, email: enrollment.applicant.email, phone: enrollment.applicant.phone },
        line_items: [{ name: resolvedPlan === 'test' ? `${catalog.product.name} — TEST ₱1 charge` : resolvedPlan === 'upfront' ? `${catalog.product.name} — upfront fee` : catalog.product.name, description: `PASS-FIRST enrollment for ${enrollment.applicant.name}`, amount: Math.round(chargeAmount * 100), currency: enrollment.currency, quantity: 1 }],
        payment_method_types: config.paymongo.paymentMethods,
        send_email_receipt: true,
        show_description: true,
        show_line_items: true,
        success_url: paymentReturnUrl('success', req.params.id),
        cancel_url: paymentReturnUrl('cancelled', req.params.id),
        reference_number: req.params.id,
        metadata: { enrollment_id: req.params.id },
      },
    },
  }
  const response = await fetch('https://api.paymongo.com/v2/checkout_sessions', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.paymongo.secretKey}:`).toString('base64')}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `treeacademy-enrollment-${req.params.id}`,
    },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result?.data?.attributes?.checkout_url) {
    console.error('PayMongo checkout-session error', response.status, result)
    return res.status(502).json({ error: 'PayMongo could not start checkout. Please try again shortly.' })
  }
  enrollment.payment = {
    provider: 'paymongo',
    checkoutId: result.data.id,
    checkoutUrl: result.data.attributes.checkout_url,
    referenceNumber: req.params.id,
    plan: resolvedPlan,
    planAmount: chargeAmount,
  }
  if (databaseReady) await enrollment.save()
  await saveAudit('payment.checkout_created', 'Enrollment', req.params.id, { checkoutId: result.data.id, plan: resolvedPlan, planAmount: chargeAmount })
  res.json({ checkoutUrl: result.data.attributes.checkout_url, mode: 'checkout_session' })
}))

// 1x1 transparent PNG, only ever used to satisfy the signature-image schema for synthetic dev enrollments.
const DEV_SIGNATURE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

app.post('/api/enrollments/:id/demo/complete-application', asyncRoute(async (req, res) => {
  if (isProduction || !config.demoMode) return res.status(404).end()
  const enrollment = await findEnrollment(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  if (enrollment.status !== 'application_pending') return res.status(409).json({ error: 'This enrollment is not awaiting an application.' })

  const values = applicationInput.parse({
    full_name: enrollment.applicant.name, birth_date: '1995-01-01', mobile: enrollment.applicant.phone || '+63 917 000 0000',
    email: enrollment.applicant.email, address: '123 Dev Street, Quezon City', emergency_name: 'Dev Emergency Contact',
    emergency_mobile: '+63 917 000 0001', school: 'University of the Philippines', degree: 'Bachelor of Science in Real Estate Management',
    grad_year: 2020, attempts: 'None — first taker', prc_status: 'Not yet started', computation_level: 'Confident',
    situational_level: 'Confident', study_hours: '5–7 hours', internet: 'Reliable', device: 'Laptop/desktop',
    commit_attend: true, commit_study: true, commit_assess: true, commit_remediate: true, commit_communicate: true,
    agree_nonsharing: true, agree_integrity: true, agree_privacy: true, agree_recording: true,
    // Extra convenience fields (outside applicationInput's real shape, kept via .passthrough()) so the
    // dev "jump to contract signing" shortcut can prefill fields the real intake form never collects.
    agmt_place: 'Quezon City', r_lic_type: 'Real estate broker', r_lic_no: 'DEV-0000',
  })
  const pdfKey = await createApplicationPdf({ data: values })
  enrollment.intake = { data: values, submittedAt: new Date(), pdfKey }
  enrollment.status = 'documents_pending'
  if (databaseReady) await enrollment.save()
  await saveAudit('enrollment.demo_application_completed', 'Enrollment', req.params.id)
  res.json({ ...publicEnrollment(enrollment), intake: values, nextStep: 'realex-reblex' })
}))

app.post('/api/enrollments/:id/demo/complete-documents', asyncRoute(async (req, res) => {
  if (isProduction || !config.demoMode) return res.status(404).end()
  const enrollment = await findEnrollment(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  if (enrollment.status !== 'documents_pending') return res.status(409).json({ error: 'This enrollment is not awaiting a signed document.' })

  const type = enrollment.applicant.pathway === 'consultant' ? 'reclex' : 'realex-reblex'
  const signatureName = enrollment.applicant.name
  const today = new Date().toISOString().slice(0, 10)
  const fields = type === 'realex-reblex'
    ? realexReblexInput.parse({ exam_type: 'REBLEX', p_name: signatureName, p_address: '123 Dev Street, Quezon City', p_contact: enrollment.applicant.phone || '+63 917 000 0000', p_email: enrollment.applicant.email, p_prc_app: 'Not yet started', p_date: today, prov_date: today })
    : reclexInput.parse({ agmt_date: today, agmt_place: 'Quezon City', r_name: signatureName, r_lic_type: 'Real estate broker', r_lic_no: 'DEV-0000', r_contact: enrollment.applicant.phone || '+63 917 000 0000', r_email: enrollment.applicant.email, r_address: '123 Dev Street, Quezon City', r_target_exam: 'REBLEX 2027 First Batch', a_date: today, b_date: today })
  const pdfKey = await createFilledDocument({ type, fields, signatureDataUrl: DEV_SIGNATURE_DATA_URL, signatureName })
  const documentName = type === 'realex-reblex' ? 'realexReblex' : 'reclex'
  enrollment.documents ??= {}
  enrollment.documents[documentName] = { pdfKey, signedAt: new Date(), signatureName }
  enrollment.status = 'payment_pending'
  if (databaseReady) await enrollment.save()
  await saveAudit('enrollment.demo_documents_completed', 'Enrollment', req.params.id)
  res.json({ ...publicEnrollment(enrollment), nextStep: 'payment' })
}))

// Dev-only: simulate the PayMongo `checkout_session.payment.paid` webhook so the paid → account
// provisioning path can be tested on localhost, where PayMongo cannot reach the real webhook.
// Mirrors the webhook's state effect exactly via the shared markEnrollmentPaid helper. 404s in
// production and whenever DEMO_MODE is off.
app.post('/api/enrollments/:id/demo/mark-paid', asyncRoute(async (req, res) => {
  if (isProduction || !config.demoMode) return res.status(404).end()
  const enrollment = await findEnrollment(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  if (!['payment_pending', 'contract_signed'].includes(enrollment.status)) return res.status(409).json({ error: 'This enrollment is not awaiting payment.' })

  const transactionId = `demo_${id()}`
  const invitation = await markEnrollmentPaid(enrollment, {
    provider: 'paymongo',
    transactionId,
    referenceNumber: enrollment.payment?.referenceNumber ?? req.params.id,
    paidAt: new Date(),
  })
  await saveAudit('payment.demo_paid_auto_approved', 'Enrollment', enrollment._id?.toString() ?? enrollment.id, { transactionId, delivery: invitation?.delivery })
  res.json({ ...publicEnrollment(enrollment), nextStep: 'complete', invitation })
}))

app.get('/api/staff/enrollments', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  // Archived enrollments (abandoned/incomplete signups an admin tidied away) are hidden unless
  // explicitly requested with ?archived=only (just archived) or ?archived=all (everything).
  const scope = req.query.archived
  if (databaseReady) {
    const filter = scope === 'all' ? {} : scope === 'only' ? { archivedAt: { $ne: null } } : { archivedAt: null }
    return res.json(await Enrollment.find(filter).sort({ createdAt: -1 }).lean())
  }
  const rows = [...memory.enrollments.values()].reverse()
  res.json(scope === 'all' ? rows : rows.filter((row) => (scope === 'only' ? row.archivedAt : !row.archivedAt)))
}))

app.post('/api/staff/enrollments/:id/decision', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const body = z.object({ decision: z.enum(['approved', 'rejected', 'refunded']), reason: z.string().trim().max(500).optional() }).parse(req.body)
  const enrollment = databaseReady ? await Enrollment.findById(req.params.id) : memory.enrollments.get(req.params.id)
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  if (!['paid_approval_pending', 'rejected'].includes(enrollment.status)) return res.status(409).json({ error: 'Enrollment cannot be decided in its current state.' })
  enrollment.status = body.decision
  enrollment.decisionReason = body.reason
  enrollment.reviewedAt = new Date()
  let invitation = null
  if (body.decision === 'approved') { invitation = await provisionLearnerAccount(enrollment); await bestEffortEmail(sendPaymentReceiptEmail(enrollment, invitation?.setupUrl), 'payment_receipt email') }
  if (databaseReady) await enrollment.save()
  await saveAudit(`enrollment.${body.decision}`, 'Enrollment', req.params.id, { reason: body.reason }, req.auth.sub)
  res.json({ ...publicEnrollment(enrollment), invitation })
}))

// --- Admin console: user management, catalog, roles, audit, content, support, analytics, reports ---

const adminOnly = [requireAuth, requireAdmin]
const requireDb = (res, feature) => { res.status(503).json({ error: `${feature} requires MongoDB.` }); return false }

const DEFAULT_PERMISSIONS = {
  learner: ['courses.view', 'assignments.submit', 'quizzes.attempt', 'certificates.view', 'support.submit', 'reports.submit'],
  instructor: ['courses.view', 'courses.manage', 'assignments.grade', 'quizzes.manage', 'enrollments.review', 'recognition.award', 'support.submit', 'reports.submit'],
  admin: ['users.manage', 'catalog.manage', 'roles.manage', 'enrollments.manage', 'audit.view', 'content.manage', 'support.manage', 'analytics.view', 'reports.manage'],
}

async function loadPermissions() {
  const saved = await RolePermission.find().lean()
  const byRole = Object.fromEntries(saved.map((row) => [row.role, row.permissions]))
  return {
    learner: byRole.learner ?? DEFAULT_PERMISSIONS.learner,
    instructor: byRole.instructor ?? DEFAULT_PERMISSIONS.instructor,
    admin: byRole.admin ?? DEFAULT_PERMISSIONS.admin,
  }
}

const adminUserView = (user) => ({
  id: user._id?.toString() ?? user.id, name: user.name, email: user.email, username: user.username ?? null,
  role: user.role, status: user.status, avatarUrl: user.avatarUrl ?? null, mustChangePassword: user.mustChangePassword,
  lastSeenAt: user.lastSeenAt, createdAt: user.createdAt,
})

app.get('/api/admin/users', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'User management')
  const query = {}
  if (['learner', 'instructor', 'admin'].includes(req.query.role)) query.role = req.query.role
  if (['invited', 'active', 'inactive', 'suspended'].includes(req.query.status)) query.status = req.query.status
  if (req.query.search) query.$or = [{ name: new RegExp(String(req.query.search).slice(0, 60), 'i') }, { email: new RegExp(String(req.query.search).slice(0, 60), 'i') }, { username: new RegExp(String(req.query.search).slice(0, 60), 'i') }]
  if (mongoose.isValidObjectId(req.query.course)) {
    const enrolled = await LearningProgress.find({ courseId: req.query.course }).distinct('learnerId')
    query._id = { $in: enrolled }
  }
  const users = await User.find(query).sort({ createdAt: -1 }).limit(500).lean()
  res.json(users.map(adminUserView))
}))

app.post('/api/admin/users', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'User management')
  const values = adminUserCreateInput.parse(req.body)
  if (await User.findOne({ email: values.email })) return res.status(409).json({ error: 'A user with that email already exists.' })
  if (values.username && await User.findOne({ username: values.username })) return res.status(409).json({ error: 'That username is already taken.' })
  const user = await User.create({
    name: values.name, email: values.email, username: values.username, role: values.role ?? 'learner', status: 'active',
  })
  if (user.role === 'instructor' && values.courseIds?.length) {
    await Course.updateMany({ _id: { $in: values.courseIds } }, { $addToSet: { assignedInstructorIds: user._id } })
  }
  const setupUrl = await issueAccountSetupUrl(user)
  const delivery = await bestEffortEmail(sendCredentialsEmail({ name: user.name, email: user.email, setupUrl }), 'enrollment_credentials email')
  await saveAudit('user.created', 'User', user.id, { role: user.role }, req.auth.sub)
  res.status(201).json({ user: adminUserView(user), setupUrl, delivery: delivery?.delivery ?? 'unknown' })
}))

app.post('/api/admin/users/import', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'User management')
  const { rows } = userImportInput.parse(req.body)
  const created = []
  const skipped = []
  for (const row of rows) {
    const email = row.email.toLowerCase()
    if (await User.findOne({ email })) { skipped.push({ email, reason: 'already exists' }); continue }
    const user = await User.create({ name: row.name, email, role: row.role ?? 'learner', status: 'active' })
    const setupUrl = await issueAccountSetupUrl(user)
    await bestEffortEmail(sendCredentialsEmail({ name: user.name, email: user.email, setupUrl }), 'enrollment_credentials email')
    created.push({ email: user.email, setupUrl })
  }
  await saveAudit('user.imported', 'User', 'bulk', { created: created.length, skipped: skipped.length }, req.auth.sub)
  res.status(201).json({ created, skipped })
}))

app.patch('/api/admin/users/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'User management')
  if (req.params.id === req.auth.sub) return res.status(409).json({ error: 'You cannot change your own account here.' })
  const updates = adminUserUpdateInput.parse(req.body)
  if (updates.email && await User.findOne({ email: updates.email.toLowerCase(), _id: { $ne: req.params.id } })) return res.status(409).json({ error: 'Another user already uses that email.' })
  if (updates.username && await User.findOne({ username: updates.username, _id: { $ne: req.params.id } })) return res.status(409).json({ error: 'That username is already taken.' })
  const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true })
  if (!user) return res.status(404).json({ error: 'User not found.' })
  if (['suspended', 'inactive'].includes(updates.status)) await RefreshToken.deleteMany({ userId: user._id })
  await saveAudit('user.updated', 'User', user.id, updates, req.auth.sub)
  res.json(adminUserView(user))
}))

app.post('/api/admin/users/:id/avatar', ...adminOnly, avatarUpload.single('avatar'), asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'User management')
  if (!req.file) return res.status(400).json({ error: 'Choose a JPG, PNG, or WEBP image under 3MB.' })
  const avatarUrl = await saveAvatarUpload(req.file)
  const user = await User.findByIdAndUpdate(req.params.id, { avatarUrl }, { new: true })
  if (!user) return res.status(404).json({ error: 'User not found.' })
  await saveAudit('user.avatar_updated', 'User', user.id, {}, req.auth.sub)
  res.json(adminUserView(user))
}))

app.delete('/api/admin/users/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'User management')
  if (req.params.id === req.auth.sub) return res.status(409).json({ error: 'You cannot delete your own account.' })
  const user = await User.findById(req.params.id)
  if (!user) return res.status(404).json({ error: 'User not found.' })
  await Promise.all([
    RefreshToken.deleteMany({ userId: user._id }),
    LearningProgress.deleteMany({ learnerId: user._id }),
    Submission.deleteMany({ learnerId: user._id }),
    StudentBadge.deleteMany({ learnerId: user._id }),
    Presence.deleteMany({ userId: user._id }),
    user.deleteOne(),
  ])
  await saveAudit('user.deleted', 'User', req.params.id, { email: user.email, role: user.role }, req.auth.sub)
  res.status(204).end()
}))

app.post('/api/admin/users/bulk-action', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'User management')
  const { ids, action } = bulkUserActionInput.parse(req.body)
  const targetIds = ids.filter((value) => value !== req.auth.sub)
  if (action === 'delete') {
    const users = await User.find({ _id: { $in: targetIds } }).select('_id').lean()
    const userIds = users.map((u) => u._id)
    await Promise.all([
      RefreshToken.deleteMany({ userId: { $in: userIds } }),
      LearningProgress.deleteMany({ learnerId: { $in: userIds } }),
      Submission.deleteMany({ learnerId: { $in: userIds } }),
      StudentBadge.deleteMany({ learnerId: { $in: userIds } }),
      Presence.deleteMany({ userId: { $in: userIds } }),
      User.deleteMany({ _id: { $in: userIds } }),
    ])
  } else {
    const status = action === 'activate' ? 'active' : action === 'suspend' ? 'suspended' : 'inactive'
    await User.updateMany({ _id: { $in: targetIds } }, { status })
    if (status !== 'active') await RefreshToken.deleteMany({ userId: { $in: targetIds } })
  }
  await saveAudit(`user.bulk_${action}`, 'User', 'bulk', { count: targetIds.length }, req.auth.sub)
  res.json({ processed: targetIds.length })
}))

app.post('/api/admin/users/bulk-enroll', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'User management')
  const { ids, courseId } = bulkEnrollInput.parse(req.body)
  if (!mongoose.isValidObjectId(courseId) || !(await Course.findById(courseId))) return res.status(404).json({ error: 'Course not found.' })
  const learners = await User.find({ _id: { $in: ids }, role: 'learner' }).select('_id').lean()
  await Promise.all(learners.map((learner) => LearningProgress.findOneAndUpdate(
    { learnerId: learner._id, courseId }, { $setOnInsert: { completedModuleIds: [] } }, { upsert: true, setDefaultsOnInsert: true })))
  await saveAudit('user.bulk_enrolled', 'Course', courseId, { count: learners.length }, req.auth.sub)
  res.json({ enrolled: learners.length })
}))

app.post('/api/admin/users/:id/password', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'User management')
  const { password } = adminPasswordInput.parse(req.body)
  const user = await User.findById(req.params.id)
  if (!user) return res.status(404).json({ error: 'User not found.' })
  user.passwordHash = await bcrypt.hash(password, 12)
  user.mustChangePassword = true
  await user.save()
  await RefreshToken.deleteMany({ userId: user._id })
  await saveAudit('user.password_reset', 'User', user.id, {}, req.auth.sub)
  res.status(204).end()
}))

app.get('/api/admin/users/:id/courses', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'User management')
  const [courses, progress] = await Promise.all([
    Course.find().select('title slug isPublished').sort({ createdAt: -1 }).lean(),
    LearningProgress.find({ learnerId: req.params.id }).select('courseId completedModuleIds completedAt').lean(),
  ])
  const enrolledMap = new Map(progress.map((row) => [String(row.courseId), row]))
  res.json(courses.map((course) => ({
    id: course._id.toString(), title: course.title, slug: course.slug, isPublished: course.isPublished,
    enrolled: enrolledMap.has(String(course._id)),
    completedModules: enrolledMap.get(String(course._id))?.completedModuleIds?.length ?? 0,
    completedAt: enrolledMap.get(String(course._id))?.completedAt ?? null,
  })))
}))

app.post('/api/admin/users/:id/courses', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'User management')
  const { courseId } = z.object({ courseId: z.string().trim().min(1) }).parse(req.body)
  if (!mongoose.isValidObjectId(courseId) || !(await Course.findById(courseId))) return res.status(404).json({ error: 'Course not found.' })
  await LearningProgress.findOneAndUpdate({ learnerId: req.params.id, courseId }, { $setOnInsert: { completedModuleIds: [] } }, { upsert: true, setDefaultsOnInsert: true })
  await saveAudit('user.enrolled', 'Course', courseId, { learnerId: req.params.id }, req.auth.sub)
  res.status(201).json({ enrolled: true })
}))

app.delete('/api/admin/users/:id/courses/:courseId', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'User management')
  await LearningProgress.deleteOne({ learnerId: req.params.id, courseId: req.params.courseId })
  await saveAudit('user.unenrolled', 'Course', req.params.courseId, { learnerId: req.params.id }, req.auth.sub)
  res.status(204).end()
}))

app.get('/api/admin/users/:id/teaching-courses', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'User management')
  const instructor = await User.findById(req.params.id).select('role')
  if (!instructor) return res.status(404).json({ error: 'User not found.' })
  if (instructor.role !== 'instructor') return res.status(409).json({ error: 'Only instructors can be assigned teaching courses.' })
  const courses = await Course.find().select('title slug assignedInstructorIds').sort({ title: 1 }).lean()
  res.json(courses.map((course) => ({ id: String(course._id), title: course.title, slug: course.slug, assigned: (course.assignedInstructorIds ?? []).some((id) => String(id) === req.params.id) })))
}))

app.put('/api/admin/users/:id/teaching-courses', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'User management')
  const { courseIds } = z.object({ courseIds: z.array(z.string().trim().min(1)).max(100) }).parse(req.body)
  const instructor = await User.findById(req.params.id).select('role')
  if (!instructor) return res.status(404).json({ error: 'User not found.' })
  if (instructor.role !== 'instructor') return res.status(409).json({ error: 'Only instructors can be assigned teaching courses.' })
  await Course.updateMany({ assignedInstructorIds: instructor._id }, { $pull: { assignedInstructorIds: instructor._id } })
  if (courseIds.length) await Course.updateMany({ _id: { $in: courseIds } }, { $addToSet: { assignedInstructorIds: instructor._id } })
  await saveAudit('instructor.courses_assigned', 'User', instructor.id, { courseIds }, req.auth.sub)
  res.json({ courseIds })
}))

app.post('/api/admin/users/:id/impersonate', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'User management')
  if (req.params.id === req.auth.sub) return res.status(409).json({ error: 'You are already signed in as yourself.' })
  const target = await User.findById(req.params.id)
  if (!target) return res.status(404).json({ error: 'User not found.' })
  if (target.status !== 'active') return res.status(409).json({ error: 'Only active accounts can be impersonated.' })
  const admin = await User.findById(req.auth.sub).select('name')
  const accessToken = await issueSession(res, target, req.auth.sub)
  await saveAudit('user.impersonation_started', 'User', target.id, {}, req.auth.sub)
  res.json({ accessToken, user: sessionUser(target, { impersonating: true, impersonatorName: admin?.name }) })
}))

app.get('/api/admin/courses', ...adminOnly, asyncRoute(async (_req, res) => {
  if (!databaseReady) return requireDb(res, 'Catalog management')
  const courses = await Course.find().sort({ createdAt: -1 }).lean()
  const [counts, enrollCounts] = await Promise.all([
    Module.aggregate([{ $group: { _id: '$courseId', count: { $sum: 1 } } }]),
    LearningProgress.aggregate([{ $group: { _id: '$courseId', count: { $sum: 1 } } }]),
  ])
  const countMap = new Map(counts.map((row) => [String(row._id), row.count]))
  const enrollMap = new Map(enrollCounts.map((row) => [String(row._id), row.count]))
  res.json(courses.map((course) => ({
    id: course._id.toString(), title: course.title, slug: course.slug, description: course.description,
    bannerPreset: course.bannerPreset ?? null, bannerUrl: course.bannerUrl ?? null,
    isPublished: course.isPublished, archivedAt: course.archivedAt ?? null,
    availableFrom: course.availableFrom ?? null, availableUntil: course.availableUntil ?? null,
    showEnrollmentCount: course.showEnrollmentCount !== false,
    approvalStatus: course.approvalStatus ?? 'draft', reviewNote: course.reviewNote ?? null,
    enrolledCount: enrollMap.get(String(course._id)) ?? 0,
    moduleCount: countMap.get(String(course._id)) ?? 0, createdAt: course.createdAt,
  })))
}))

app.patch('/api/admin/courses/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Catalog management')
  const { isPublished, archived, availableFrom, availableUntil, showEnrollmentCount } = adminCourseInput.parse(req.body)
  const updates = {}
  if (isPublished !== undefined) updates.isPublished = isPublished
  if (archived !== undefined) updates.archivedAt = archived ? new Date() : null
  if (availableFrom !== undefined) updates.availableFrom = availableFrom
  if (availableUntil !== undefined) updates.availableUntil = availableUntil
  if (showEnrollmentCount !== undefined) updates.showEnrollmentCount = showEnrollmentCount
  const course = await Course.findByIdAndUpdate(req.params.id, updates, { new: true })
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  await saveAudit('course.moderated', 'Course', course.id, updates, req.auth.sub)
  res.json({
    id: course.id, isPublished: course.isPublished, archivedAt: course.archivedAt ?? null,
    availableFrom: course.availableFrom ?? null, availableUntil: course.availableUntil ?? null,
    showEnrollmentCount: course.showEnrollmentCount !== false,
  })
}))

app.delete('/api/admin/courses/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Catalog management')
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const modules = await Module.find({ courseId: course._id }).select('_id').lean()
  const moduleIds = modules.map((m) => m._id)
  await Promise.all([
    Lesson.deleteMany({ moduleId: { $in: moduleIds } }),
    Module.deleteMany({ courseId: course._id }),
    Assignment.deleteMany({ courseId: course._id }),
    Quiz.deleteMany({ courseId: course._id }),
    course.deleteOne(),
  ])
  await saveAudit('course.deleted', 'Course', req.params.id, { title: course.title }, req.auth.sub)
  res.status(204).end()
}))

app.get('/api/admin/webinars', ...adminOnly, asyncRoute(async (_req, res) => {
  if (!databaseReady) return requireDb(res, 'Webinar management')
  const webinars = await Webinar.find().sort({ startsAt: 1 }).lean()
  const counts = await WebinarRegistration.aggregate([{ $group: { _id: '$webinarId', count: { $sum: 1 } } }])
  const countById = new Map(counts.map((row) => [String(row._id), row.count]))
  res.json(webinars.map((webinar) => ({
    id: webinar._id.toString(), title: webinar.title, description: webinar.description ?? '',
    startsAt: webinar.startsAt, registrationDeadline: webinar.registrationDeadline ?? null,
    capacity: webinar.capacity ?? null, isPublished: webinar.isPublished,
    registeredCount: countById.get(String(webinar._id)) ?? 0, createdAt: webinar.createdAt,
  })))
}))

app.post('/api/admin/webinars', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Webinar management')
  const webinar = await Webinar.create({ ...webinarInput.parse(req.body), createdBy: req.auth.sub })
  await saveAudit('webinar.created', 'Webinar', webinar.id, {}, req.auth.sub)
  res.status(201).json(webinar)
}))

app.patch('/api/admin/webinars/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Webinar management')
  const webinar = await Webinar.findByIdAndUpdate(req.params.id, webinarUpdateInput.parse(req.body), { new: true })
  if (!webinar) return res.status(404).json({ error: 'Webinar not found.' })
  await saveAudit('webinar.updated', 'Webinar', webinar.id, {}, req.auth.sub)
  res.json(webinar)
}))

app.delete('/api/admin/webinars/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Webinar management')
  const webinar = await Webinar.findByIdAndDelete(req.params.id)
  if (!webinar) return res.status(404).json({ error: 'Webinar not found.' })
  await WebinarRegistration.deleteMany({ webinarId: webinar._id })
  await saveAudit('webinar.deleted', 'Webinar', webinar.id, {}, req.auth.sub)
  res.status(204).end()
}))

app.get('/api/admin/webinars/:id/registrations', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Webinar management')
  const registrations = await WebinarRegistration.find({ webinarId: req.params.id }).sort({ createdAt: -1 }).lean()
  res.json(registrations)
}))

app.get('/api/admin/email-templates', ...adminOnly, asyncRoute(async (_req, res) => {
  if (!databaseReady) return requireDb(res, 'Email automation')
  const templates = await EmailTemplate.find().lean()
  const byKey = new Map(templates.map((template) => [template.key, template]))
  res.json(Object.keys(emailTemplateDefaults).map((key) => {
    const template = byKey.get(key)
    return template
      ? { key, subject: template.subject, body: template.body, fromName: template.fromName ?? '', fromEmail: template.fromEmail ?? '', enabled: template.enabled, updatedAt: template.updatedAt }
      : { key, ...emailTemplateDefaults[key], fromName: '', fromEmail: '', enabled: true, updatedAt: null }
  }))
}))

app.patch('/api/admin/email-templates/:key', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Email automation')
  if (!Object.hasOwn(emailTemplateDefaults, req.params.key)) return res.status(404).json({ error: 'Unknown email template.' })
  const updates = emailTemplateUpdateInput.parse(req.body)
  const template = await EmailTemplate.findOneAndUpdate({ key: req.params.key }, { ...updates, updatedBy: req.auth.sub }, { new: true, upsert: true, setDefaultsOnInsert: true })
  await saveAudit('email_template.updated', 'EmailTemplate', req.params.key, {}, req.auth.sub)
  res.json(template)
}))

app.get('/api/admin/permissions', ...adminOnly, asyncRoute(async (_req, res) => {
  if (!databaseReady) return res.json(DEFAULT_PERMISSIONS)
  res.json(await loadPermissions())
}))

app.put('/api/admin/permissions', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Role permissions')
  const matrix = permissionsInput.parse(req.body)
  await Promise.all(Object.entries(matrix).map(([role, permissions]) =>
    RolePermission.findOneAndUpdate({ role }, { permissions, updatedBy: req.auth.sub }, { upsert: true, setDefaultsOnInsert: true })))
  await saveAudit('permissions.updated', 'RolePermission', 'matrix', {}, req.auth.sub)
  res.json(matrix)
}))

app.post('/api/admin/enrollments/bulk-decision', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Enrollment management')
  const { ids, decision, reason } = bulkDecisionInput.parse(req.body)
  const results = []
  for (const enrollmentId of ids) {
    const enrollment = await Enrollment.findById(enrollmentId)
    if (!enrollment || !['paid_approval_pending', 'rejected'].includes(enrollment.status)) { results.push({ id: enrollmentId, ok: false }); continue }
    enrollment.status = decision
    enrollment.decisionReason = reason
    enrollment.reviewedAt = new Date()
    enrollment.reviewedBy = req.auth.sub
    if (decision === 'approved') { const invitation = await provisionLearnerAccount(enrollment); await bestEffortEmail(sendPaymentReceiptEmail(enrollment, invitation?.setupUrl), 'payment_receipt email') }
    await enrollment.save()
    await saveAudit(`enrollment.${decision}`, 'Enrollment', enrollmentId, { reason, bulk: true }, req.auth.sub)
    results.push({ id: enrollmentId, ok: true })
  }
  res.json({ processed: results.filter((r) => r.ok).length, results })
}))

app.post('/api/admin/enrollments/:id/archive', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Enrollment management')
  const { archived } = z.object({ archived: z.boolean() }).parse(req.body)
  const enrollment = await Enrollment.findByIdAndUpdate(req.params.id, { archivedAt: archived ? new Date() : null }, { new: true })
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found.' })
  await saveAudit(archived ? 'enrollment.archived' : 'enrollment.unarchived', 'Enrollment', req.params.id, {}, req.auth.sub)
  res.json({ id: enrollment.id, archivedAt: enrollment.archivedAt ?? null })
}))

app.get('/api/admin/audit-logs', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Audit logs')
  const query = {}
  if (req.query.entityType) query.entityType = String(req.query.entityType).slice(0, 60)
  if (req.query.action) query.action = new RegExp(String(req.query.action).slice(0, 60), 'i')
  const logs = await AuditLog.find(query).sort({ createdAt: -1 }).limit(300).populate('actorId', 'name email role').lean()
  res.json(logs.map((log) => ({
    id: log._id.toString(), action: log.action, entityType: log.entityType, entityId: log.entityId,
    metadata: log.metadata, actor: log.actorId ? { name: log.actorId.name, email: log.actorId.email, role: log.actorId.role } : null,
    createdAt: log.createdAt,
  })))
}))

app.get('/api/admin/content-assets', ...adminOnly, asyncRoute(async (_req, res) => {
  if (!databaseReady) return requireDb(res, 'Content library')
  const assets = await ContentAsset.find().sort({ createdAt: -1 }).populate('createdBy', 'name').lean()
  res.json(assets.map((asset) => ({
    id: asset._id.toString(), title: asset.title, description: asset.description, category: asset.category,
    url: asset.url, tags: asset.tags ?? [], createdBy: asset.createdBy?.name ?? null, createdAt: asset.createdAt,
  })))
}))

app.post('/api/admin/content-assets', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Content library')
  const values = contentAssetInput.parse(req.body)
  const asset = await ContentAsset.create({ ...values, createdBy: req.auth.sub })
  await saveAudit('content_asset.created', 'ContentAsset', asset.id, { category: asset.category }, req.auth.sub)
  res.status(201).json({ id: asset.id, title: asset.title, category: asset.category })
}))

app.delete('/api/admin/content-assets/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Content library')
  const asset = await ContentAsset.findByIdAndDelete(req.params.id)
  if (!asset) return res.status(404).json({ error: 'Asset not found.' })
  await saveAudit('content_asset.deleted', 'ContentAsset', req.params.id, {}, req.auth.sub)
  res.status(204).end()
}))

app.post('/api/support/tickets', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Support tickets')
  const values = supportTicketInput.parse(req.body)
  const ticket = await SupportTicket.create({ ...values, requesterId: req.auth.sub })
  await saveAudit('support_ticket.created', 'SupportTicket', ticket.id, { category: ticket.category }, req.auth.sub)
  res.status(201).json({ id: ticket.id, status: ticket.status })
}))

app.get('/api/admin/support/tickets', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Support tickets')
  const query = {}
  if (['open', 'in_progress', 'resolved', 'closed'].includes(req.query.status)) query.status = req.query.status
  const tickets = await SupportTicket.find(query).sort({ createdAt: -1 }).limit(300).populate('requesterId', 'name email role').lean()
  res.json(tickets.map((ticket) => ({
    id: ticket._id.toString(), subject: ticket.subject, category: ticket.category, message: ticket.message,
    status: ticket.status, priority: ticket.priority, response: ticket.response,
    requester: ticket.requesterId ? { name: ticket.requesterId.name, email: ticket.requesterId.email, role: ticket.requesterId.role } : null,
    createdAt: ticket.createdAt,
  })))
}))

app.patch('/api/admin/support/tickets/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Support tickets')
  const updates = supportUpdateInput.parse(req.body)
  const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, { ...updates, handledBy: req.auth.sub }, { new: true })
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' })
  await saveAudit('support_ticket.updated', 'SupportTicket', ticket.id, updates, req.auth.sub)
  res.json({ id: ticket.id, status: ticket.status, priority: ticket.priority, response: ticket.response })
}))

app.post('/api/reports', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Reports')
  const values = reportInput.parse(req.body)
  const report = await Report.create({ ...values, reporterId: req.auth.sub, reporterRole: req.auth.role })
  await saveAudit('report.created', 'Report', report.id, { type: report.type }, req.auth.sub)
  res.status(201).json({ id: report.id, status: report.status })
}))

app.get('/api/admin/reports', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Reports')
  const query = {}
  if (['submitted', 'reviewing', 'actioned', 'dismissed'].includes(req.query.status)) query.status = req.query.status
  if (['learner', 'instructor', 'admin'].includes(req.query.role)) query.reporterRole = req.query.role
  const reports = await Report.find(query).sort({ createdAt: -1 }).limit(300).populate('reporterId', 'name email role').lean()
  res.json(reports.map((report) => ({
    id: report._id.toString(), type: report.type, title: report.title, details: report.details,
    status: report.status, reviewNote: report.reviewNote, reporterRole: report.reporterRole,
    reporter: report.reporterId ? { name: report.reporterId.name, email: report.reporterId.email, role: report.reporterId.role } : null,
    createdAt: report.createdAt,
  })))
}))

app.patch('/api/admin/reports/:id', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Reports')
  const updates = reportUpdateInput.parse(req.body)
  const report = await Report.findByIdAndUpdate(req.params.id, { ...updates, reviewedBy: req.auth.sub }, { new: true })
  if (!report) return res.status(404).json({ error: 'Report not found.' })
  await saveAudit('report.updated', 'Report', report.id, updates, req.auth.sub)
  res.json({ id: report.id, status: report.status, reviewNote: report.reviewNote })
}))

app.get('/api/admin/analytics', ...adminOnly, asyncRoute(async (_req, res) => {
  if (!databaseReady) return requireDb(res, 'Analytics')
  const [usersByRole, usersByStatus, enrollmentsByStatus, courseTotal, coursePublished, revenueAgg, submissionTotal, ticketOpen, reportOpen] = await Promise.all([
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    User.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Enrollment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Course.countDocuments(),
    Course.countDocuments({ isPublished: true }),
    Enrollment.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Submission.countDocuments({ submittedAt: { $ne: null } }),
    SupportTicket.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
    Report.countDocuments({ status: { $in: ['submitted', 'reviewing'] } }),
  ])
  const toMap = (rows) => Object.fromEntries(rows.map((row) => [row._id ?? 'unknown', row.count]))
  res.json({
    usersByRole: toMap(usersByRole),
    usersByStatus: toMap(usersByStatus),
    enrollmentsByStatus: toMap(enrollmentsByStatus),
    courses: { total: courseTotal, published: coursePublished },
    revenue: revenueAgg[0]?.total ?? 0,
    submissions: submissionTotal,
    openTickets: ticketOpen,
    openReports: reportOpen,
  })
}))

app.get('/api/admin/dashboard', ...adminOnly, asyncRoute(async (_req, res) => {
  if (!databaseReady) return requireDb(res, 'Dashboard')
  const since = new Date()
  since.setMonth(since.getMonth() - 5, 1)
  since.setHours(0, 0, 0, 0)
  const monthly = (Model) => Model.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 } } },
  ])
  const [usersByRole, courseTotal, coursePublished, activeByPathway, pendingEnrollments, openReports, signupMonths, enrollmentMonths, recentUsers, recentCourses, recentActions, progressTotal, progressCompleted] = await Promise.all([
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    Course.countDocuments(),
    Course.countDocuments({ isPublished: true }),
    Enrollment.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: '$applicant.pathway', count: { $sum: 1 } } }]),
    Enrollment.countDocuments({ status: 'paid_approval_pending' }),
    Report.countDocuments({ status: { $in: ['submitted', 'reviewing'] } }),
    monthly(User),
    monthly(Enrollment),
    User.find().sort({ createdAt: -1 }).limit(5).select('name email role createdAt').lean(),
    Course.find().sort({ createdAt: -1 }).limit(5).select('title isPublished createdAt').lean(),
    AuditLog.find().sort({ createdAt: -1 }).limit(8).populate('actorId', 'name role').lean(),
    LearningProgress.countDocuments(),
    LearningProgress.countDocuments({ completedAt: { $ne: null } }),
  ])
  const toMap = (rows) => Object.fromEntries(rows.map((row) => [row._id ?? 'unknown', row.count]))
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(since.getFullYear(), since.getMonth() + index, 1)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  })
  const signupMap = toMap(signupMonths)
  const enrollmentMap = toMap(enrollmentMonths)
  res.json({
    usersByRole: toMap(usersByRole),
    courses: { total: courseTotal, published: coursePublished },
    activeEnrollmentsByPathway: toMap(activeByPathway),
    pending: { enrollments: pendingEnrollments, courses: courseTotal - coursePublished, reports: openReports },
    growth: months.map((month) => ({ month, signups: signupMap[month] ?? 0, enrollments: enrollmentMap[month] ?? 0 })),
    recentUsers,
    recentCourses,
    recentActions: recentActions.map((log) => ({ id: log._id, action: log.action, actor: log.actorId?.name ?? 'System', createdAt: log.createdAt })),
    completionRate: progressTotal ? Math.round((progressCompleted / progressTotal) * 100) : 0,
  })
}))

app.get('/api/badges/me', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Badges require MongoDB.' })
  const badges = await StudentBadge.find({ learnerId: req.auth.sub }).populate('badgeId', 'title description color icon').sort({ createdAt: -1 }).lean()
  res.json(badges)
}))

app.post('/api/staff/badges', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Badge management requires MongoDB.' })
  const values = badgeInput.parse(req.body)
  const badge = await Badge.create({ ...values, createdBy: req.auth.sub })
  await saveAudit('badge.created', 'Badge', badge.id, { title: badge.title }, req.auth.sub)
  res.status(201).json(badge)
}))

app.post('/api/staff/badges/:badgeId/award', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Badge awards require MongoDB.' })
  const { learnerId, note } = awardInput.parse(req.body)
  const [badge, learner] = await Promise.all([Badge.findById(req.params.badgeId), User.findOne({ _id: learnerId, role: 'learner' })])
  if (!badge || !learner) return res.status(404).json({ error: 'Badge or learner not found.' })
  const award = await StudentBadge.findOneAndUpdate({ badgeId: badge._id, learnerId: learner._id }, { awardedBy: req.auth.sub, note }, { new: true, upsert: true, setDefaultsOnInsert: true })
  await saveAudit('badge.awarded', 'StudentBadge', award.id, { badgeId: badge.id, learnerId: learner.id }, req.auth.sub)
  res.status(201).json(award)
}))

app.post('/api/staff/certificate-templates', requireAuth, requireStaff, certificateUpload.single('layout'), asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Certificate templates require MongoDB.' })
  if (!req.file) return res.status(422).json({ error: 'Upload a PDF, PNG, or JPEG certificate layout.' })
  const values = certificateTemplateInput.parse(req.body)
  if (!mongoose.isValidObjectId(values.targetId)) return res.status(422).json({ error: 'Certificate target is invalid.' })
  const fileKey = await saveCertificateTemplate(req.file)
  const template = await CertificateTemplate.create({
    title: values.title,
    scope: values.scope,
    targetId: values.targetId,
    fileKey,
    mimeType: req.file.mimetype,
    namePosition: { x: values.nameX ?? 260, y: values.nameY ?? 140, size: values.nameSize ?? 30 },
    createdBy: req.auth.sub,
  })
  await saveAudit('certificate_template.created', 'CertificateTemplate', template.id, { scope: template.scope, targetId: values.targetId }, req.auth.sub)
  res.status(201).json(template)
}))

app.post('/api/staff/certificates/issue', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Certificate issuing requires MongoDB.' })
  const { templateId, learnerId } = certificateIssueInput.parse(req.body)
  const [template, learner] = await Promise.all([CertificateTemplate.findById(templateId), User.findOne({ _id: learnerId, role: 'learner' })])
  if (!template || !learner) return res.status(404).json({ error: 'Certificate template or learner not found.' })
  const certificate = await issueCertificate({ template, learner, issuedBy: req.auth.sub })
  res.status(201).json(certificate)
}))

app.post('/api/learning/modules/:moduleId/complete', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Module completion requires MongoDB.' })
  if (req.auth.role !== 'learner') return res.status(403).json({ error: 'Only learners can complete their own modules.' })
  const module = await Module.findById(req.params.moduleId)
  if (!module) return res.status(404).json({ error: 'Module not found.' })
  const progress = await LearningProgress.findOneAndUpdate(
    { learnerId: req.auth.sub, courseId: module.courseId },
    { $addToSet: { completedModuleIds: module._id } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )
  const learner = await User.findById(req.auth.sub)
  const moduleTemplates = await CertificateTemplate.find({ scope: 'module', targetId: module._id })
  const issued = await Promise.all(moduleTemplates.map((template) => issueCertificate({ template, learner, issuedBy: null })))
  const moduleCount = await Module.countDocuments({ courseId: module.courseId })
  if (moduleCount > 0 && progress.completedModuleIds.length >= moduleCount) {
    progress.completedAt = new Date()
    await progress.save()
    const programTemplates = await CertificateTemplate.find({ scope: 'program', targetId: module.courseId })
    issued.push(...await Promise.all(programTemplates.map((template) => issueCertificate({ template, learner, issuedBy: null }))))
  }
  await saveAudit('module.completed', 'Module', module.id, { learnerId: learner.id, certificatesIssued: issued.length }, learner.id)
  res.json({ completedModuleIds: progress.completedModuleIds, certificates: issued.map((certificate) => certificate.id) })
}))

app.get('/api/certificates/:id/download', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Certificate downloads require MongoDB.' })
  const certificate = await Certificate.findById(req.params.id)
  if (!certificate) return res.status(404).json({ error: 'Certificate not found.' })
  if (String(certificate.learnerId) !== req.auth.sub && !['instructor', 'admin'].includes(req.auth.role)) return res.status(403).json({ error: 'You cannot download this certificate.' })
  res.download(getPrivateFilePath(certificate.fileKey), `Tree-Academy-Certificate-${certificate.id}.pdf`)
}))

// --- LMS content: courses, modules, lessons, assignments, quizzes, calendar, notifications ---

async function courseProgressMap(learnerId, courseIds) {
  if (!learnerId || !courseIds.length) return new Map()
  const records = await LearningProgress.find({ learnerId, courseId: { $in: courseIds } }).lean()
  return new Map(records.map((record) => [String(record.courseId), record]))
}

app.get('/api/courses', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Courses require MongoDB.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  const courses = await Course.find(isStaff ? {} : await learnerVisibleCourseFilter(req.auth.sub)).sort({ createdAt: 1 }).lean()
  const courseIds = courses.map((course) => course._id)
  const moduleCounts = await Module.aggregate([
    { $match: { courseId: { $in: courseIds }, isPublished: true } },
    { $group: { _id: '$courseId', count: { $sum: 1 } } },
  ])
  const countByCourse = new Map(moduleCounts.map((row) => [String(row._id), row.count]))
  const progressByCourse = req.auth.role === 'learner' ? await courseProgressMap(req.auth.sub, courseIds) : new Map()
  res.json(courses.map((course) => {
    const moduleCount = countByCourse.get(String(course._id)) ?? 0
    const completedCount = progressByCourse.get(String(course._id))?.completedModuleIds?.length ?? 0
    return { ...course, moduleCount, completedModuleCount: completedCount, progressPercent: moduleCount ? Math.round((completedCount / moduleCount) * 100) : 0 }
  }))
}))

app.get('/api/courses/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Courses require MongoDB.' })
  const course = await Course.findById(req.params.id).lean()
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (!isStaff) {
    if (!course.isPublished || !courseIsAvailable(course)) return res.status(404).json({ error: 'Course not found.' })
    const enrolled = await LearningProgress.exists({ learnerId: req.auth.sub, courseId: course._id })
    if (!enrolled) return res.status(404).json({ error: 'Course not found.' })
  }
  const modules = await Module.find(isStaff ? { courseId: course._id } : { courseId: course._id, isPublished: true }).sort({ position: 1 }).lean()
  const moduleIds = modules.map((module) => module._id)
  const lessons = await Lesson.find(isStaff ? { moduleId: { $in: moduleIds } } : { moduleId: { $in: moduleIds }, isPublished: true }).sort({ position: 1 }).lean()
  const lessonsByModule = new Map()
  for (const lesson of lessons) {
    const key = String(lesson.moduleId)
    if (!lessonsByModule.has(key)) lessonsByModule.set(key, [])
    lessonsByModule.get(key).push(lesson)
  }
  const progress = req.auth.role === 'learner' ? await LearningProgress.findOne({ learnerId: req.auth.sub, courseId: course._id }).lean() : null
  const completedModuleIds = new Set((progress?.completedModuleIds ?? []).map(String))

  // Assignments are nested where the learner is actually reading: under their lesson, or under the
  // phase itself as a fallback when no specific lesson was chosen at creation time.
  const assignments = await Assignment.find(isStaff ? { courseId: course._id } : { courseId: course._id, moduleId: { $in: moduleIds } }).sort({ dueAt: 1 }).lean()
  const submissionByAssignment = new Map()
  if (req.auth.role === 'learner') {
    const submissions = await Submission.find({ learnerId: req.auth.sub, assignmentId: { $in: assignments.map((assignment) => assignment._id) } }).lean()
    for (const submission of submissions) submissionByAssignment.set(String(submission.assignmentId), submission)
  }
  const shapeAssignment = (assignment) => ({
    id: assignment._id, _id: assignment._id, position: assignment.position ?? 0,
    title: assignment.title, instructions: assignment.instructions ?? null,
    instructionsUrl: assignment.instructionsUrl ?? null, dueAt: assignment.dueAt ?? null, maxPoints: assignment.maxPoints,
    mySubmission: submissionByAssignment.get(String(assignment._id)) ?? null,
  })
  const assignmentsByLesson = new Map()
  const assignmentsByModule = new Map()
  for (const assignment of assignments) {
    if (assignment.lessonId) {
      const key = String(assignment.lessonId)
      if (!assignmentsByLesson.has(key)) assignmentsByLesson.set(key, [])
      assignmentsByLesson.get(key).push(assignment)
    } else {
      const key = String(assignment.moduleId)
      if (!assignmentsByModule.has(key)) assignmentsByModule.set(key, [])
      assignmentsByModule.get(key).push(assignment)
    }
  }

  // Quizzes scoped to a phase (moduleId set) are surfaced inline in the builder's per-phase
  // Sections list, alongside that phase's lessons and module-level assignments — staff only, so
  // learner-facing course reads are unaffected.
  const quizzesByModule = new Map()
  if (isStaff) {
    const quizzes = await Quiz.find({ moduleId: { $in: moduleIds } }, { 'questions.answerIndex': 0, 'questions.explanation': 0, 'questions.acceptableAnswers': 0, 'questions.pairs': 0 }).lean()
    for (const quiz of quizzes) {
      const key = String(quiz.moduleId)
      if (!quizzesByModule.has(key)) quizzesByModule.set(key, [])
      quizzesByModule.get(key).push({ ...quiz, questionCount: quiz.questions?.length ?? 0 })
    }
  }

  res.json({
    ...course,
    modules: modules.map((module) => ({
      ...module,
      completed: completedModuleIds.has(String(module._id)),
      assignments: (assignmentsByModule.get(String(module._id)) ?? []).map(shapeAssignment),
      quizzes: quizzesByModule.get(String(module._id)) ?? [],
      lessons: (lessonsByModule.get(String(module._id)) ?? []).map((lesson) => ({
        ...lesson, assignments: (assignmentsByLesson.get(String(lesson._id)) ?? []).map(shapeAssignment),
      })),
    })),
  })
}))

app.get('/api/courses/:id/categories', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Courses require MongoDB.' })
  const course = await Course.findById(req.params.id).lean()
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (!isStaff) {
    if (!course.isPublished || !courseIsAvailable(course) || !(await LearningProgress.exists({ learnerId: req.auth.sub, courseId: course._id }))) return res.status(404).json({ error: 'Course not found.' })
  }
  const categories = await Category.find({ courseId: course._id, ...(isStaff ? {} : { status: 'published' }) }).sort({ position: 1 }).lean()
  res.json(categories)
}))

app.get('/api/courses/:id/categories/:categoryId', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Courses require MongoDB.' })
  const course = await Course.findById(req.params.id).lean()
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (!isStaff) {
    if (!course.isPublished || !courseIsAvailable(course) || !(await LearningProgress.exists({ learnerId: req.auth.sub, courseId: course._id }))) return res.status(404).json({ error: 'Course not found.' })
  }
  const category = await Category.findOne({ _id: req.params.categoryId, courseId: course._id, ...(isStaff ? {} : { status: 'published' }) }).lean()
  if (!category) return res.status(404).json({ error: 'Category not found.' })
  const headers = await CategoryHeader.find({ categoryId: category._id }).sort({ position: 1 }).lean()
  const headerIds = headers.map((item) => item._id)
  const modules = await LearningModule.find({ headerId: { $in: headerIds }, ...(isStaff ? {} : { status: 'published' }) }).sort({ position: 1 }).lean()
  const modulesByHeader = new Map(headerIds.map((id) => [String(id), []]))
  modules.forEach((item) => modulesByHeader.get(String(item.headerId))?.push(item))
  const headersWithModules = headers.map((item) => ({ ...item, modules: modulesByHeader.get(String(item._id)) ?? [] })).filter((item) => isStaff || item.modules.length > 0)
  res.json({ ...category, headers: headersWithModules })
}))

app.post('/api/staff/courses', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Courses require MongoDB.' })
  const values = courseInput.parse(req.body)
  const course = await Course.create(values)
  await saveAudit('course.created', 'Course', course.id, { title: course.title }, req.auth.sub)
  res.status(201).json(course)
}))

app.patch('/api/staff/courses/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Courses require MongoDB.' })
  const values = courseUpdateInput.parse(req.body)
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  // Instructors can't publish until an admin has signed off; admins bypass the gate.
  if (values.isPublished && req.auth.role !== 'admin' && course.approvalStatus !== 'approved') {
    return res.status(409).json({ error: 'This course needs admin approval before it can be published. Submit it for review first.' })
  }
  Object.assign(course, values)
  await course.save()
  await saveAudit('course.updated', 'Course', course.id, {}, req.auth.sub)
  res.json(course)
}))

app.post('/api/staff/courses/:id/banner', requireAuth, requireStaff, bannerUpload.single('banner'), asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Banner uploads require MongoDB.' })
  if (!req.file) return res.status(400).json({ error: 'Choose a JPG, PNG, or WEBP image under 4MB.' })
  const bannerUrl = await saveBannerUpload(req.file)
  const course = await Course.findByIdAndUpdate(req.params.id, { bannerUrl, bannerPreset: null }, { new: true })
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  await saveAudit('course.banner_updated', 'Course', course.id, {}, req.auth.sub)
  res.json({ bannerUrl, course })
}))

// --- Instructor catalogue builder: course -> category -> header -> typed learning module ---
async function editableCourse(req, res, courseId) {
  const course = await Course.findById(courseId)
  if (!course) { res.status(404).json({ error: 'Course not found.' }); return null }
  if (req.auth.role !== 'admin' && !course.assignedInstructorIds.some((id) => String(id) === req.auth.sub)) {
    res.status(403).json({ error: 'You are not assigned to this course.' }); return null
  }
  return course
}

app.get('/api/staff/builder/courses', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Course builder requires MongoDB.' })
  const filter = req.auth.role === 'admin' ? {} : { assignedInstructorIds: req.auth.sub }
  res.json(await Course.find(filter).select('title slug description bannerPreset bannerUrl isPublished').sort({ title: 1 }).lean())
}))

app.get('/api/staff/builder/courses/:courseId/categories', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Course builder requires MongoDB.' })
  if (!(await editableCourse(req, res, req.params.courseId))) return
  const categories = await Category.find({ courseId: req.params.courseId }).sort({ position: 1 }).lean()
  const ids = categories.map((item) => item._id)
  const headers = await CategoryHeader.find({ categoryId: { $in: ids } }).sort({ position: 1 }).lean()
  const headerIds = headers.map((item) => item._id)
  const modules = await LearningModule.find({ headerId: { $in: headerIds } }).sort({ position: 1 }).lean()
  const modulesByHeader = new Map(headerIds.map((id) => [String(id), []]))
  modules.forEach((item) => modulesByHeader.get(String(item.headerId))?.push(item))
  const headersByCategory = new Map(ids.map((id) => [String(id), []]))
  headers.forEach((item) => headersByCategory.get(String(item.categoryId))?.push({ ...item, modules: modulesByHeader.get(String(item._id)) ?? [] }))
  res.json(categories.map((item) => ({ ...item, headers: headersByCategory.get(String(item._id)) ?? [] })))
}))

app.post('/api/staff/builder/courses/:courseId/categories', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Course builder requires MongoDB.' })
  if (!(await editableCourse(req, res, req.params.courseId))) return
  res.status(201).json(await Category.create({ ...categoryInput.parse(req.body), courseId: req.params.courseId }))
}))
app.patch('/api/staff/builder/categories/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const category = await Category.findById(req.params.id); if (!category || !(await editableCourse(req, res, category.courseId))) return
  res.json(await Category.findByIdAndUpdate(category._id, categoryUpdateInput.parse(req.body), { new: true }))
}))
app.delete('/api/staff/builder/categories/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const category = await Category.findById(req.params.id); if (!category || !(await editableCourse(req, res, category.courseId))) return
  const headers = await CategoryHeader.find({ categoryId: category._id }).select('_id')
  await LearningModule.deleteMany({ headerId: { $in: headers.map((item) => item._id) } }); await CategoryHeader.deleteMany({ categoryId: category._id }); await category.deleteOne()
  res.status(204).end()
}))
app.post('/api/staff/builder/categories/:categoryId/headers', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const category = await Category.findById(req.params.categoryId); if (!category || !(await editableCourse(req, res, category.courseId))) return
  res.status(201).json(await CategoryHeader.create({ ...categoryHeaderInput.parse(req.body), categoryId: category._id }))
}))
app.patch('/api/staff/builder/headers/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const header = await CategoryHeader.findById(req.params.id); const category = header && await Category.findById(header.categoryId); if (!header || !category || !(await editableCourse(req, res, category.courseId))) return
  res.json(await CategoryHeader.findByIdAndUpdate(header._id, categoryHeaderInput.partial().parse(req.body), { new: true }))
}))
app.post('/api/staff/builder/headers/:headerId/modules', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const header = await CategoryHeader.findById(req.params.headerId); const category = header && await Category.findById(header.categoryId); if (!header || !category || !(await editableCourse(req, res, category.courseId))) return
  res.status(201).json(await LearningModule.create({ ...learningModuleInput.parse(req.body), headerId: header._id }))
}))
app.patch('/api/staff/builder/modules/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  const module = await LearningModule.findById(req.params.id); const header = module && await CategoryHeader.findById(module.headerId); const category = header && await Category.findById(header.categoryId); if (!module || !category || !(await editableCourse(req, res, category.courseId))) return
  res.json(await LearningModule.findByIdAndUpdate(module._id, learningModuleUpdateInput.parse(req.body), { new: true }))
}))

app.post('/api/staff/courses/:id/submit-review', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Courses require MongoDB.' })
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  if (course.approvalStatus === 'approved') return res.status(409).json({ error: 'This course is already approved.' })
  if (course.approvalStatus === 'pending_review') return res.status(409).json({ error: 'This course is already awaiting review.' })
  course.approvalStatus = 'pending_review'
  course.reviewNote = undefined
  await course.save()
  await saveAudit('course.submitted_for_review', 'Course', course.id, {}, req.auth.sub)
  res.json(course)
}))

app.post('/api/admin/courses/:id/review', ...adminOnly, asyncRoute(async (req, res) => {
  if (!databaseReady) return requireDb(res, 'Catalog management')
  const { decision, note } = courseReviewInput.parse(req.body)
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  course.approvalStatus = decision
  course.reviewNote = note || undefined
  if (decision === 'rejected') course.isPublished = false
  await course.save()
  await saveAudit(`course.review_${decision}`, 'Course', course.id, { note: note || null }, req.auth.sub)
  res.json(course)
}))

app.post('/api/staff/courses/:id/modules', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Modules require MongoDB.' })
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const module = await Module.create({ ...moduleInput.parse(req.body), courseId: course._id })
  await saveAudit('module.created', 'Module', module.id, { courseId: course.id }, req.auth.sub)
  res.status(201).json(module)
}))

app.patch('/api/staff/modules/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Modules require MongoDB.' })
  const module = await Module.findByIdAndUpdate(req.params.id, moduleUpdateInput.parse(req.body), { new: true })
  if (!module) return res.status(404).json({ error: 'Module not found.' })
  await saveAudit('module.updated', 'Module', module.id, {}, req.auth.sub)
  res.json(module)
}))

app.delete('/api/staff/modules/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Modules require MongoDB.' })
  const module = await Module.findByIdAndDelete(req.params.id)
  if (!module) return res.status(404).json({ error: 'Module not found.' })
  await Lesson.deleteMany({ moduleId: module._id })
  const assignments = await Assignment.find({ moduleId: module._id }).select('_id')
  await Submission.deleteMany({ assignmentId: { $in: assignments.map((item) => item._id) } })
  await Assignment.deleteMany({ moduleId: module._id })
  await LearningProgress.updateMany({}, { $pull: { completedModuleIds: module._id } })
  await saveAudit('module.deleted', 'Module', module.id, {}, req.auth.sub)
  res.status(204).end()
}))

app.post('/api/staff/modules/:id/lessons', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Lessons require MongoDB.' })
  const module = await Module.findById(req.params.id)
  if (!module) return res.status(404).json({ error: 'Module not found.' })
  const lesson = await Lesson.create({ ...lessonInput.parse(req.body), moduleId: module._id })
  await saveAudit('lesson.created', 'Lesson', lesson.id, { moduleId: module.id }, req.auth.sub)
  res.status(201).json(lesson)
}))

app.patch('/api/staff/lessons/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Lessons require MongoDB.' })
  const lesson = await Lesson.findByIdAndUpdate(req.params.id, lessonUpdateInput.parse(req.body), { new: true })
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' })
  await saveAudit('lesson.updated', 'Lesson', lesson.id, {}, req.auth.sub)
  res.json(lesson)
}))

app.delete('/api/staff/lessons/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Lessons require MongoDB.' })
  const lesson = await Lesson.findByIdAndDelete(req.params.id)
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' })
  await Assignment.updateMany({ lessonId: lesson._id }, { $set: { lessonId: null } })
  await saveAudit('lesson.deleted', 'Lesson', lesson.id, {}, req.auth.sub)
  res.status(204).end()
}))

app.get('/api/assignments', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Assignments require MongoDB.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  const courses = await Course.find(isStaff ? {} : await learnerVisibleCourseFilter(req.auth.sub)).select('_id title').lean()
  const courseTitleById = new Map(courses.map((course) => [String(course._id), course.title]))
  const assignments = await Assignment.find({ courseId: { $in: courses.map((course) => course._id) } }).sort({ dueAt: 1 }).lean()
  let submissionByAssignment = new Map()
  if (req.auth.role === 'learner') {
    const submissions = await Submission.find({ learnerId: req.auth.sub, assignmentId: { $in: assignments.map((assignment) => assignment._id) } }).lean()
    submissionByAssignment = new Map(submissions.map((submission) => [String(submission.assignmentId), submission]))
  }
  res.json(assignments.map((assignment) => ({ ...assignment, courseTitle: courseTitleById.get(String(assignment.courseId)) ?? 'Course', mySubmission: submissionByAssignment.get(String(assignment._id)) ?? null })))
}))

app.get('/api/assignments/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Assignments require MongoDB.' })
  const assignment = await Assignment.findById(req.params.id).lean()
  if (!assignment) return res.status(404).json({ error: 'Assignment not found.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (!isStaff) {
    const enrolled = await LearningProgress.exists({ learnerId: req.auth.sub, courseId: assignment.courseId })
    if (!enrolled) return res.status(404).json({ error: 'Assignment not found.' })
  }
  const [course, module, lesson, submission] = await Promise.all([
    Course.findById(assignment.courseId).select('title').lean(),
    Module.findById(assignment.moduleId).select('title phaseNumber').lean(),
    assignment.lessonId ? Lesson.findById(assignment.lessonId).select('title').lean() : null,
    req.auth.role === 'learner' ? Submission.findOne({ assignmentId: assignment._id, learnerId: req.auth.sub }).lean() : null,
  ])
  res.json({
    ...assignment, courseTitle: course?.title ?? 'Course', moduleTitle: module?.title ?? null,
    phaseNumber: module?.phaseNumber ?? null, lessonTitle: lesson?.title ?? null,
    mySubmission: submission,
  })
}))

app.post('/api/staff/courses/:id/assignments', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Assignments require MongoDB.' })
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const values = assignmentInput.parse(req.body)
  const module = await Module.findOne({ _id: values.moduleId, courseId: course._id })
  if (!module) return res.status(404).json({ error: 'Phase not found in this course.' })
  if (values.lessonId && !(await Lesson.exists({ _id: values.lessonId, moduleId: module._id }))) return res.status(404).json({ error: 'Lesson not found in this phase.' })
  const assignment = await Assignment.create({ ...values, courseId: course._id })
  await saveAudit('assignment.created', 'Assignment', assignment.id, { courseId: course.id }, req.auth.sub)
  res.status(201).json(assignment)
}))

app.patch('/api/staff/assignments/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Assignments require MongoDB.' })
  const assignment = await Assignment.findByIdAndUpdate(req.params.id, assignmentUpdateInput.parse(req.body), { new: true })
  if (!assignment) return res.status(404).json({ error: 'Assignment not found.' })
  await saveAudit('assignment.updated', 'Assignment', assignment.id, {}, req.auth.sub)
  res.json(assignment)
}))

app.delete('/api/staff/assignments/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Assignments require MongoDB.' })
  const assignment = await Assignment.findByIdAndDelete(req.params.id)
  if (!assignment) return res.status(404).json({ error: 'Assignment not found.' })
  await Submission.deleteMany({ assignmentId: assignment._id })
  await saveAudit('assignment.deleted', 'Assignment', assignment.id, {}, req.auth.sub)
  res.status(204).end()
}))

app.post('/api/assignments/:id/submissions', requireAuth, submissionUpload.single('attachment'), asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Submissions require MongoDB.' })
  if (req.auth.role !== 'learner') return res.status(403).json({ error: 'Only learners can submit assignments.' })
  const assignment = await Assignment.findById(req.params.id)
  if (!assignment) return res.status(404).json({ error: 'Assignment not found.' })
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : ''
  const existing = await Submission.findOne({ assignmentId: assignment._id, learnerId: req.auth.sub })
  const submissionType = assignment.submissionType ?? 'both'
  if (submissionType === 'text' && req.file) return res.status(400).json({ error: 'This assignment only accepts a written response, not a file.' })
  if (submissionType === 'file' && !req.file && !existing?.attachmentKey) return res.status(400).json({ error: 'This assignment requires a file upload.' })
  if (!body && !req.file && !existing?.attachmentKey) return res.status(400).json({ error: 'Add a response or a file before submitting.' })
  const update = { body: body || undefined, submittedAt: new Date() }
  if (req.file) {
    update.attachmentKey = await saveSubmissionAttachment(req.file)
    update.attachmentName = req.file.originalname
  }
  const submission = await Submission.findOneAndUpdate(
    { assignmentId: assignment._id, learnerId: req.auth.sub },
    { $set: update, $unset: { grade: '', feedback: '' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )
  await saveAudit('submission.submitted', 'Submission', submission.id, { assignmentId: assignment.id }, req.auth.sub)
  const [learner, staff] = await Promise.all([
    User.findById(req.auth.sub).select('name').lean(),
    User.find({ role: { $in: ['instructor', 'admin'] }, status: 'active' }).select('_id').lean(),
  ])
  await notifyUsers(staff.map((member) => member._id), {
    title: `New submission: ${assignment.title}`,
    body: `${learner?.name ?? 'A learner'} submitted "${assignment.title}".`,
    link: '/gradebook',
  })
  res.status(201).json(submission)
}))

app.get('/api/submissions/:id/attachment', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Submissions require MongoDB.' })
  const submission = await Submission.findById(req.params.id)
  if (!submission || !submission.attachmentKey) return res.status(404).json({ error: 'No attachment found.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (!isStaff && String(submission.learnerId) !== req.auth.sub) return res.status(403).json({ error: 'You cannot download this attachment.' })
  res.download(getPrivateFilePath(submission.attachmentKey), submission.attachmentName || `submission-${submission.id}`)
}))

app.get('/api/staff/assignments/:id/submissions', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Submissions require MongoDB.' })
  const submissions = await Submission.find({ assignmentId: req.params.id }).populate('learnerId', 'name email').sort({ submittedAt: -1 }).lean()
  res.json(submissions)
}))

app.post('/api/staff/submissions/:id/grade', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Grading requires MongoDB.' })
  const submission = await Submission.findByIdAndUpdate(req.params.id, gradeInput.parse(req.body), { new: true })
  if (!submission) return res.status(404).json({ error: 'Submission not found.' })
  await saveAudit('submission.graded', 'Submission', submission.id, {}, req.auth.sub)
  const assignment = await Assignment.findById(submission.assignmentId).select('title').lean()
  await notifyUsers([submission.learnerId], {
    title: `Graded: ${assignment?.title ?? 'Assignment'}`,
    body: `You scored ${submission.grade}${submission.feedback ? ` — ${submission.feedback}` : ''}`,
    link: `/assignments/${submission.assignmentId}`,
  })
  res.json(submission)
}))

// Threaded comments on a submission — a lighter-weight back-and-forth than the single overwritable
// `feedback` field, open to the submission's learner and any staff member.
app.get('/api/submissions/:id/comments', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Comments require MongoDB.' })
  const submission = await Submission.findById(req.params.id).select('learnerId').lean()
  if (!submission) return res.status(404).json({ error: 'Submission not found.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (!isStaff && String(submission.learnerId) !== req.auth.sub) return res.status(403).json({ error: 'You cannot view these comments.' })
  const comments = await SubmissionComment.find({ submissionId: submission._id }).sort({ createdAt: 1 }).populate('authorId', 'name avatarUrl').lean()
  res.json(comments.map((comment) => ({
    id: comment._id.toString(), body: comment.body, authorRole: comment.authorRole, createdAt: comment.createdAt,
    author: comment.authorId ? { name: comment.authorId.name, avatarUrl: comment.authorId.avatarUrl ?? null } : null,
  })))
}))

app.post('/api/submissions/:id/comments', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Comments require MongoDB.' })
  const submission = await Submission.findById(req.params.id)
  if (!submission) return res.status(404).json({ error: 'Submission not found.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (!isStaff && String(submission.learnerId) !== req.auth.sub) return res.status(403).json({ error: 'You cannot comment here.' })
  const values = submissionCommentInput.parse(req.body)
  const comment = await SubmissionComment.create({ submissionId: submission._id, authorId: req.auth.sub, authorRole: req.auth.role, body: values.body })
  await saveAudit('submission.commented', 'Submission', submission.id, {}, req.auth.sub)
  const [author, assignment] = await Promise.all([
    User.findById(req.auth.sub).select('name').lean(),
    Assignment.findById(submission.assignmentId).select('title').lean(),
  ])
  if (isStaff) {
    await notifyUsers([submission.learnerId], { title: `New comment on: ${assignment?.title ?? 'your submission'}`, body: `${author?.name ?? 'Your instructor'} left a comment.`, link: `/assignments/${submission.assignmentId}` })
  } else {
    const staff = await User.find({ role: { $in: ['instructor', 'admin'] }, status: 'active' }).select('_id').lean()
    await notifyUsers(staff.map((member) => member._id), { title: `New comment on: ${assignment?.title ?? 'a submission'}`, body: `${author?.name ?? 'A learner'} left a comment.`, link: '/gradebook' })
  }
  res.status(201).json({
    id: comment._id.toString(), body: comment.body, authorRole: comment.authorRole, createdAt: comment.createdAt,
    author: author ? { name: author.name, avatarUrl: null } : null,
  })
}))

// Instructor teaching workspace — all instructors share every course, so "their courses" and
// "their students" span the whole catalog. These aggregation routes power the instructor
// dashboard, gradebook, and roster.
const ungradedFilter = { submittedAt: { $ne: null }, $or: [{ grade: { $exists: false } }, { grade: null }] }

app.get('/api/staff/overview', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'The teaching dashboard requires MongoDB.' })
  const [courses, learnerCount, pendingGrading, upcoming, pendingApprovals] = await Promise.all([
    Course.find().select('_id title isPublished').lean(),
    User.countDocuments({ role: 'learner', status: 'active' }),
    Submission.countDocuments(ungradedFilter),
    Assignment.find({ dueAt: { $gte: new Date() } }).sort({ dueAt: 1 }).limit(6).lean(),
    Enrollment.countDocuments({ status: 'paid_approval_pending' }),
  ])
  const titleById = new Map(courses.map((course) => [String(course._id), course.title]))
  res.json({
    courseCount: courses.length,
    publishedCount: courses.filter((course) => course.isPublished).length,
    learnerCount,
    pendingGrading,
    pendingApprovals,
    upcomingDeadlines: upcoming.map((assignment) => ({ id: assignment._id.toString(), title: assignment.title, dueAt: assignment.dueAt, courseTitle: titleById.get(String(assignment.courseId)) ?? 'Course' })),
  })
}))

app.get('/api/staff/grading-queue', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Grading requires MongoDB.' })
  const courses = await Course.find().select('_id title').lean()
  const titleById = new Map(courses.map((course) => [String(course._id), course.title]))
  const submissions = await Submission.find(ungradedFilter)
    .populate('learnerId', 'name email')
    .populate('assignmentId', 'title courseId maxPoints')
    .sort({ submittedAt: 1 }).limit(200).lean()
  res.json(submissions.map((submission) => ({
    id: submission._id.toString(),
    learner: submission.learnerId ? { name: submission.learnerId.name, email: submission.learnerId.email } : null,
    assignmentTitle: submission.assignmentId?.title ?? 'Assignment',
    maxPoints: submission.assignmentId?.maxPoints ?? 100,
    courseTitle: titleById.get(String(submission.assignmentId?.courseId)) ?? 'Course',
    submittedAt: submission.submittedAt,
    body: submission.body ?? '',
    attachmentKey: submission.attachmentKey ?? null,
    attachmentName: submission.attachmentName ?? null,
  })))
}))

app.get('/api/staff/learners', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'The roster requires MongoDB.' })
  const learners = await User.find({ role: 'learner' }).select('name email status createdAt lastSeenAt avatarUrl').sort({ name: 1 }).lean()
  const grouped = await LearningProgress.aggregate([
    { $group: { _id: '$learnerId', courses: { $sum: 1 }, modules: { $sum: { $size: { $ifNull: ['$completedModuleIds', []] } } } } },
  ])
  const statsById = new Map(grouped.map((row) => [String(row._id), row]))
  res.json(learners.map((learner) => ({
    id: learner._id.toString(), name: learner.name, email: learner.email, status: learner.status,
    avatarUrl: learner.avatarUrl ?? null, createdAt: learner.createdAt, lastSeenAt: learner.lastSeenAt ?? null,
    enrolledCourses: statsById.get(String(learner._id))?.courses ?? 0,
    completedModules: statsById.get(String(learner._id))?.modules ?? 0,
  })))
}))

app.get('/api/staff/courses/:id/gradebook', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'The gradebook requires MongoDB.' })
  const course = await Course.findById(req.params.id).select('title slug').lean()
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const assignments = await Assignment.find({ courseId: course._id }).select('title maxPoints dueAt').sort({ createdAt: 1 }).lean()
  const progresses = await LearningProgress.find({ courseId: course._id }).select('learnerId').lean()
  const learnerIds = progresses.map((progress) => progress.learnerId)
  const learners = await User.find({ _id: { $in: learnerIds } }).select('name email').sort({ name: 1 }).lean()
  const submissions = await Submission.find({ assignmentId: { $in: assignments.map((assignment) => assignment._id) }, learnerId: { $in: learnerIds } })
    .select('assignmentId learnerId grade feedback body attachmentKey attachmentName submittedAt').lean()
  res.json({
    course: { id: course._id.toString(), title: course.title, slug: course.slug },
    assignments: assignments.map((assignment) => ({ id: assignment._id.toString(), title: assignment.title, maxPoints: assignment.maxPoints ?? 100, dueAt: assignment.dueAt ?? null })),
    learners: learners.map((learner) => ({ id: learner._id.toString(), name: learner.name, email: learner.email })),
    submissions: submissions.map((submission) => ({
      id: submission._id.toString(), assignmentId: String(submission.assignmentId), learnerId: String(submission.learnerId),
      grade: submission.grade ?? null, feedback: submission.feedback ?? '', body: submission.body ?? '',
      attachmentKey: submission.attachmentKey ?? null, attachmentName: submission.attachmentName ?? null,
      submittedAt: submission.submittedAt ?? null,
    })),
  })
}))

app.get('/api/staff/courses/:id/analytics', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Course analytics require MongoDB.' })
  const course = await Course.findById(req.params.id).select('title slug').lean()
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const [modules, assignments] = await Promise.all([
    Module.find({ courseId: course._id, isPublished: true }).select('title position').sort({ position: 1 }).lean(),
    Assignment.find({ courseId: course._id }).select('title maxPoints dueAt').lean(),
  ])
  const moduleCount = modules.length
  const progresses = await LearningProgress.find({ courseId: course._id }).select('learnerId completedModuleIds completedAt').lean()
  const learnerIds = progresses.map((progress) => progress.learnerId)
  const learners = await User.find({ _id: { $in: learnerIds } }).select('name email').lean()
  const learnerById = new Map(learners.map((learner) => [String(learner._id), learner]))
  const assignmentMax = new Map(assignments.map((assignment) => [String(assignment._id), assignment.maxPoints ?? 100]))
  const submissions = await Submission.find({ assignmentId: { $in: assignments.map((assignment) => assignment._id) }, learnerId: { $in: learnerIds } })
    .select('assignmentId learnerId grade submittedAt').lean()

  const moduleCompletion = new Map(modules.map((module) => [String(module._id), 0]))
  const gradesByLearner = new Map()
  const submittedByLearner = new Map()
  for (const submission of submissions) {
    const learnerKey = String(submission.learnerId)
    submittedByLearner.set(learnerKey, (submittedByLearner.get(learnerKey) ?? 0) + 1)
    if (submission.grade != null) {
      const percent = Math.round((submission.grade / (assignmentMax.get(String(submission.assignmentId)) || 100)) * 100)
      if (!gradesByLearner.has(learnerKey)) gradesByLearner.set(learnerKey, [])
      gradesByLearner.get(learnerKey).push(percent)
    }
  }

  const roster = progresses.map((progress) => {
    const learnerKey = String(progress.learnerId)
    const completed = (progress.completedModuleIds ?? []).filter((moduleId) => moduleCompletion.has(String(moduleId)))
    for (const moduleId of completed) moduleCompletion.set(String(moduleId), moduleCompletion.get(String(moduleId)) + 1)
    const progressPercent = moduleCount ? Math.round((completed.length / moduleCount) * 100) : 0
    const grades = gradesByLearner.get(learnerKey) ?? []
    const avgGrade = grades.length ? Math.round(grades.reduce((sum, value) => sum + value, 0) / grades.length) : null
    const missing = assignments.length - (submittedByLearner.get(learnerKey) ?? 0)
    const reasons = []
    if (progressPercent < 40) reasons.push('Low progress')
    if (avgGrade != null && avgGrade < 60) reasons.push('Low grades')
    if (missing > 0 && assignments.length > 0) reasons.push(`${missing} not submitted`)
    const learner = learnerById.get(learnerKey)
    return { id: learnerKey, name: learner?.name ?? 'Learner', email: learner?.email ?? '', progressPercent, avgGrade, missing, completed: Boolean(progress.completedAt), reasons }
  }).sort((first, second) => first.progressPercent - second.progressPercent)

  const learnerCount = roster.length
  const completionRate = learnerCount ? Math.round(roster.reduce((sum, row) => sum + row.progressPercent, 0) / learnerCount) : 0
  const gradedPercents = [...gradesByLearner.values()].flat()
  const avgGrade = gradedPercents.length ? Math.round(gradedPercents.reduce((sum, value) => sum + value, 0) / gradedPercents.length) : null
  const submissionRate = learnerCount && assignments.length ? Math.round((submissions.length / (assignments.length * learnerCount)) * 100) : 0

  res.json({
    course: { id: course._id.toString(), title: course.title, slug: course.slug },
    learnerCount,
    moduleCount,
    assignmentCount: assignments.length,
    completedLearners: roster.filter((row) => row.completed).length,
    completionRate,
    avgGrade,
    submissionRate,
    moduleBreakdown: modules.map((module) => ({ id: module._id.toString(), title: module.title, completedCount: moduleCompletion.get(String(module._id)) ?? 0, percent: learnerCount ? Math.round(((moduleCompletion.get(String(module._id)) ?? 0) / learnerCount) * 100) : 0 })),
    atRisk: roster.filter((row) => row.reasons.length > 0),
  })
}))

app.get('/api/quizzes', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Quizzes require MongoDB.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  const courses = await Course.find(isStaff ? {} : await learnerVisibleCourseFilter(req.auth.sub)).select('_id title').lean()
  const courseTitleById = new Map(courses.map((course) => [String(course._id), course.title]))
  const courseIds = courses.map((course) => course._id)
  const quizFilter = isStaff ? { courseId: { $in: courseIds } } : { courseId: { $in: courseIds }, isPublished: true }
  const quizzes = await Quiz.find(quizFilter, { 'questions.answerIndex': 0, 'questions.explanation': 0, 'questions.acceptableAnswers': 0, 'questions.pairs': 0 }).sort({ createdAt: 1 }).lean()
  res.json(quizzes.map((quiz) => ({ ...quiz, courseTitle: courseTitleById.get(String(quiz.courseId)) ?? 'Course', questionCount: quiz.questions?.length ?? 0 })))
}))

// Strips the answer key from a question before it reaches a learner. Matching questions need
// special handling: the left/right pairing itself IS the answer, so instead of hiding `pairs`
// outright (which would leave nothing to render), the left prompts and a shuffled list of right
// options are sent as decoupled arrays.
function sanitizeQuestionForLearner(question) {
  const base = { type: question.type ?? 'multiple_choice', prompt: question.prompt }
  if (question.type === 'matching') {
    const pairs = question.pairs ?? []
    const rights = pairs.map((pair) => pair.right)
    for (let i = rights.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1));[rights[i], rights[j]] = [rights[j], rights[i]] }
    return { ...base, lefts: pairs.map((pair) => pair.left), rights }
  }
  if (question.type === 'enumeration') return { ...base, minAnswers: question.minAnswers }
  if (question.type === 'fill_blank' || question.type === 'essay') return base
  return { ...base, choices: question.choices }
}

app.get('/api/quizzes/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Quizzes require MongoDB.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  const quiz = await Quiz.findById(req.params.id).lean()
  if (!quiz || (!quiz.isPublished && !isStaff)) return res.status(404).json({ error: 'Quiz not found.' })
  if (isStaff) return res.json(quiz)
  res.json({ ...quiz, questions: quiz.questions.map(sanitizeQuestionForLearner) })
}))

app.post('/api/staff/courses/:id/quizzes', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Quizzes require MongoDB.' })
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const values = quizInput.parse(req.body)
  if (values.moduleId && !(await Module.exists({ _id: values.moduleId, courseId: course._id }))) return res.status(404).json({ error: 'Phase not found in this course.' })
  const quiz = await Quiz.create({ ...values, courseId: course._id })
  await saveAudit('quiz.created', 'Quiz', quiz.id, { courseId: course.id }, req.auth.sub)
  res.status(201).json(quiz)
}))

app.patch('/api/staff/quizzes/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Quizzes require MongoDB.' })
  const values = quizUpdateInput.parse(req.body)
  if (values.moduleId) {
    const existing = await Quiz.findById(req.params.id).select('courseId').lean()
    if (!existing) return res.status(404).json({ error: 'Quiz not found.' })
    if (!(await Module.exists({ _id: values.moduleId, courseId: existing.courseId }))) return res.status(404).json({ error: 'Phase not found in this course.' })
  }
  const quiz = await Quiz.findByIdAndUpdate(req.params.id, values, { new: true })
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' })
  await saveAudit('quiz.updated', 'Quiz', quiz.id, {}, req.auth.sub)
  res.json(quiz)
}))

app.delete('/api/staff/quizzes/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Quizzes require MongoDB.' })
  const quiz = await Quiz.findByIdAndDelete(req.params.id)
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' })
  await saveAudit('quiz.deleted', 'Quiz', quiz.id, {}, req.auth.sub)
  res.status(204).end()
}))

// Auto-grades one question against a learner's answer; the answer's shape depends on the
// question's type (see quizQuestionInput above). `essay` is never auto-graded — it returns
// correct: null so it's excluded from the score and shown back for self-review instead.
function gradeQuizQuestion(question, answer) {
  const normalize = (value) => String(value ?? '').trim().toLowerCase()
  switch (question.type ?? 'multiple_choice') {
    case 'fill_blank':
      return { correct: (question.acceptableAnswers ?? []).some((accepted) => normalize(accepted) === normalize(answer)), response: answer ?? '' }
    case 'enumeration': {
      const accepted = new Set((question.acceptableAnswers ?? []).map(normalize))
      const given = Array.isArray(answer) ? answer : []
      const matchedCount = new Set(given.map(normalize).filter((value) => accepted.has(value))).size
      return { correct: matchedCount >= (question.minAnswers ?? (question.acceptableAnswers ?? []).length), matchedCount, response: given }
    }
    case 'matching': {
      const given = answer && typeof answer === 'object' ? answer : {}
      return { correct: (question.pairs ?? []).every((pair, index) => given[index] === pair.right), response: given }
    }
    case 'essay':
      return { correct: null, response: typeof answer === 'string' ? answer : '' }
    default:
      return { correct: answer === question.answerIndex, selectedIndex: answer ?? null }
  }
}

app.post('/api/quizzes/:id/attempt', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Quiz attempts require MongoDB.' })
  if (req.auth.role !== 'learner') return res.status(403).json({ error: 'Only learners can attempt quizzes.' })
  const quiz = await Quiz.findById(req.params.id).lean()
  if (!quiz || !quiz.isPublished) return res.status(404).json({ error: 'Quiz not found.' })
  const { answers } = quizAttemptInput.parse(req.body)
  const results = quiz.questions.map((question, index) => ({
    type: question.type ?? 'multiple_choice',
    prompt: question.prompt,
    choices: question.choices,
    answerIndex: question.answerIndex,
    acceptableAnswers: question.acceptableAnswers,
    pairs: question.pairs,
    minAnswers: question.minAnswers,
    explanation: question.explanation,
    ...gradeQuizQuestion(question, answers[index]),
  }))
  const gradable = results.filter((result) => result.correct !== null)
  const score = gradable.filter((result) => result.correct).length
  await saveAudit('quiz.attempted', 'Quiz', quiz._id.toString(), { score, total: gradable.length }, req.auth.sub)
  res.json({ score, total: gradable.length, percent: gradable.length ? Math.round((score / gradable.length) * 100) : 0, results })
}))

// Class communication — course announcements (one-way) and discussion forums (two-way).
async function visibleCourses(role, learnerId) {
  const isStaff = ['instructor', 'admin'].includes(role)
  return Course.find(isStaff ? {} : await learnerVisibleCourseFilter(learnerId)).select('_id title').lean()
}

app.get('/api/announcements', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Announcements require MongoDB.' })
  const courses = await visibleCourses(req.auth.role, req.auth.sub)
  const titleById = new Map(courses.map((course) => [String(course._id), course.title]))
  const announcements = await Announcement.find({ courseId: { $in: courses.map((course) => course._id) } })
    .populate('authorId', 'name role').sort({ pinned: -1, createdAt: -1 }).limit(100).lean()
  res.json(announcements.map((announcement) => ({
    id: announcement._id.toString(), courseId: String(announcement.courseId),
    courseTitle: titleById.get(String(announcement.courseId)) ?? 'Course',
    title: announcement.title, body: announcement.body, pinned: announcement.pinned,
    authorName: announcement.authorId?.name ?? 'Staff', createdAt: announcement.createdAt,
  })))
}))

app.post('/api/staff/courses/:id/announcements', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Announcements require MongoDB.' })
  const course = await Course.findById(req.params.id)
  if (!course) return res.status(404).json({ error: 'Course not found.' })
  const values = announcementInput.parse(req.body)
  const announcement = await Announcement.create({ ...values, courseId: course._id, authorId: req.auth.sub })
  // Notify every learner granted access to this course (LearningProgress is the enrollment record,
  // created automatically when their pathway enrollment is approved — see provisionLearnerAccount).
  const enrolled = await LearningProgress.find({ courseId: course._id }).select('learnerId').lean()
  if (enrolled.length) await Notification.insertMany(enrolled.map((row) => ({ recipientId: row.learnerId, title: `${course.title}: ${values.title}`, body: values.body.slice(0, 300), link: '/announcements' })))
  await saveAudit('announcement.created', 'Announcement', announcement.id, { courseId: course.id }, req.auth.sub)
  res.status(201).json(announcement)
}))

app.delete('/api/staff/announcements/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Announcements require MongoDB.' })
  const announcement = await Announcement.findByIdAndDelete(req.params.id)
  if (!announcement) return res.status(404).json({ error: 'Announcement not found.' })
  await saveAudit('announcement.deleted', 'Announcement', announcement.id, {}, req.auth.sub)
  res.status(204).end()
}))

app.get('/api/forums/threads', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Forums require MongoDB.' })
  const courses = await visibleCourses(req.auth.role, req.auth.sub)
  const titleById = new Map(courses.map((course) => [String(course._id), course.title]))
  const filter = { courseId: { $in: courses.map((course) => course._id) } }
  if (req.query.courseId) filter.courseId = req.query.courseId
  const threads = await ForumThread.find(filter).populate('authorId', 'name role').sort({ isPinned: -1, lastPostAt: -1 }).limit(100).lean()
  const counts = await ForumPost.aggregate([{ $match: { threadId: { $in: threads.map((thread) => thread._id) } } }, { $group: { _id: '$threadId', count: { $sum: 1 } } }])
  const countById = new Map(counts.map((row) => [String(row._id), row.count]))
  res.json(threads.map((thread) => ({
    id: thread._id.toString(), courseId: String(thread.courseId),
    courseTitle: titleById.get(String(thread.courseId)) ?? 'Course',
    title: thread.title, isPinned: thread.isPinned, isLocked: thread.isLocked,
    authorName: thread.authorId?.name ?? 'Member', authorRole: thread.authorId?.role ?? 'learner',
    replyCount: countById.get(String(thread._id)) ?? 0, lastPostAt: thread.lastPostAt, createdAt: thread.createdAt,
  })))
}))

app.post('/api/forums/threads', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Forums require MongoDB.' })
  const values = forumThreadInput.parse(req.body)
  const course = await Course.findById(values.courseId)
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (!course || (!course.isPublished && !isStaff)) return res.status(404).json({ error: 'Course not found.' })
  const thread = await ForumThread.create({ ...values, authorId: req.auth.sub })
  await saveAudit('forum_thread.created', 'ForumThread', thread.id, { courseId: course.id }, req.auth.sub)
  res.status(201).json(thread)
}))

app.get('/api/forums/threads/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Forums require MongoDB.' })
  const thread = await ForumThread.findById(req.params.id).populate('authorId', 'name role').lean()
  if (!thread) return res.status(404).json({ error: 'Thread not found.' })
  const course = await Course.findById(thread.courseId).select('title isPublished').lean()
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (!course || (!course.isPublished && !isStaff)) return res.status(404).json({ error: 'Thread not found.' })
  const posts = await ForumPost.find({ threadId: thread._id }).populate('authorId', 'name role').sort({ createdAt: 1 }).lean()
  res.json({
    id: thread._id.toString(), courseId: String(thread.courseId), courseTitle: course.title,
    title: thread.title, body: thread.body, isPinned: thread.isPinned, isLocked: thread.isLocked,
    authorName: thread.authorId?.name ?? 'Member', authorRole: thread.authorId?.role ?? 'learner', createdAt: thread.createdAt,
    posts: posts.map((post) => ({ id: post._id.toString(), body: post.body, authorId: String(post.authorId?._id ?? post.authorId), authorName: post.authorId?.name ?? 'Member', authorRole: post.authorId?.role ?? 'learner', createdAt: post.createdAt })),
  })
}))

app.post('/api/forums/threads/:id/posts', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Forums require MongoDB.' })
  const thread = await ForumThread.findById(req.params.id)
  if (!thread) return res.status(404).json({ error: 'Thread not found.' })
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  if (thread.isLocked && !isStaff) return res.status(403).json({ error: 'This thread is locked.' })
  const values = forumPostInput.parse(req.body)
  const post = await ForumPost.create({ threadId: thread._id, authorId: req.auth.sub, body: values.body })
  thread.lastPostAt = new Date()
  await thread.save()
  res.status(201).json(post)
}))

app.patch('/api/staff/forums/threads/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Forums require MongoDB.' })
  const thread = await ForumThread.findByIdAndUpdate(req.params.id, forumModerateInput.parse(req.body), { new: true })
  if (!thread) return res.status(404).json({ error: 'Thread not found.' })
  await saveAudit('forum_thread.moderated', 'ForumThread', thread.id, { isPinned: thread.isPinned, isLocked: thread.isLocked }, req.auth.sub)
  res.json(thread)
}))

app.delete('/api/staff/forums/threads/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Forums require MongoDB.' })
  const thread = await ForumThread.findByIdAndDelete(req.params.id)
  if (!thread) return res.status(404).json({ error: 'Thread not found.' })
  await ForumPost.deleteMany({ threadId: thread._id })
  await saveAudit('forum_thread.deleted', 'ForumThread', thread.id, {}, req.auth.sub)
  res.status(204).end()
}))

app.delete('/api/staff/forums/posts/:id', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Forums require MongoDB.' })
  const post = await ForumPost.findByIdAndDelete(req.params.id)
  if (!post) return res.status(404).json({ error: 'Post not found.' })
  await saveAudit('forum_post.deleted', 'ForumPost', post.id, { threadId: String(post.threadId) }, req.auth.sub)
  res.status(204).end()
}))

app.get('/api/calendar', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Calendar requires MongoDB.' })
  const filter = {}
  if (req.query.type) filter.eventType = req.query.type
  const events = await CalendarEvent.find(filter).sort({ startsAt: 1 }).lean()
  const courses = await Course.find({ _id: { $in: events.map((event) => event.courseId).filter(Boolean) } }).select('title').lean()
  const titleById = new Map(courses.map((course) => [String(course._id), course.title]))
  res.json(events.map((event) => ({ ...event, courseTitle: event.courseId ? (titleById.get(String(event.courseId)) ?? null) : null })))
}))

app.post('/api/staff/calendar-events', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Calendar requires MongoDB.' })
  const event = await CalendarEvent.create(calendarEventInput.parse(req.body))
  await saveAudit('calendar_event.created', 'CalendarEvent', event.id, {}, req.auth.sub)
  res.status(201).json(event)
}))

// Built-in attendance — a roll-call roster per calendar session, restricted to events tied to a
// course (attendance needs a learner list to check off, which only a course enrollment gives us).
app.get('/api/staff/calendar-events/:id/attendance', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Attendance requires MongoDB.' })
  const event = await CalendarEvent.findById(req.params.id).lean()
  if (!event) return res.status(404).json({ error: 'Event not found.' })
  if (!event.courseId) return res.status(400).json({ error: 'This event is not linked to a course, so it has no roster to take attendance for.' })
  const progresses = await LearningProgress.find({ courseId: event.courseId }).select('learnerId').lean()
  const learners = await User.find({ _id: { $in: progresses.map((progress) => progress.learnerId) } }).select('name email').sort({ name: 1 }).lean()
  const records = await Attendance.find({ eventId: event._id }).lean()
  const statusByLearner = new Map(records.map((record) => [String(record.learnerId), record.status]))
  res.json({
    event: { id: event._id.toString(), title: event.title, startsAt: event.startsAt, courseId: String(event.courseId) },
    roster: learners.map((learner) => ({ learnerId: learner._id.toString(), name: learner.name, email: learner.email, status: statusByLearner.get(String(learner._id)) ?? null })),
  })
}))

app.post('/api/staff/calendar-events/:id/attendance', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Attendance requires MongoDB.' })
  const event = await CalendarEvent.findById(req.params.id).lean()
  if (!event) return res.status(404).json({ error: 'Event not found.' })
  if (!event.courseId) return res.status(400).json({ error: 'This event is not linked to a course, so attendance cannot be recorded.' })
  const values = attendanceInput.parse(req.body)
  const now = new Date()
  await Promise.all(values.records.map((record) => Attendance.findOneAndUpdate(
    { eventId: event._id, learnerId: record.learnerId },
    { $set: { courseId: event.courseId, status: record.status, markedBy: req.auth.sub, markedAt: now } },
    { upsert: true, setDefaultsOnInsert: true },
  )))
  await saveAudit('attendance.recorded', 'CalendarEvent', event._id.toString(), { count: values.records.length }, req.auth.sub)
  res.json({ ok: true, count: values.records.length })
}))

app.get('/api/calendar-events/:id/attendance/me', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Attendance requires MongoDB.' })
  if (req.auth.role !== 'learner') return res.json({ status: null })
  const record = await Attendance.findOne({ eventId: req.params.id, learnerId: req.auth.sub }).select('status markedAt').lean()
  res.json({ status: record?.status ?? null, markedAt: record?.markedAt ?? null })
}))

app.get('/api/search', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.json({ courses: [], announcements: [], users: [] })
  const term = String(req.query.q ?? '').trim()
  if (term.length < 2) return res.json({ courses: [], announcements: [], users: [] })
  const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const isStaff = ['instructor', 'admin'].includes(req.auth.role)
  const courseFilter = isStaff ? {} : await learnerVisibleCourseFilter(req.auth.sub)
  const searchableCourseIds = isStaff ? undefined : (await Course.find(courseFilter).select('_id').lean()).map((course) => course._id)
  const [courses, announcements, users] = await Promise.all([
    Course.find({ ...courseFilter, $or: [{ title: regex }, { description: regex }] }).select('title slug isPublished').limit(6).lean(),
    Announcement.find({ ...(isStaff ? {} : { courseId: { $in: searchableCourseIds } }), $or: [{ title: regex }, { body: regex }] }).select('title courseId createdAt').limit(6).lean(),
    isStaff ? User.find({ status: 'active', $or: [{ name: regex }, { email: regex }] }).select('name email role avatarUrl').limit(6).lean() : Promise.resolve([]),
  ])
  res.json({
    courses: courses.map((course) => ({ id: course._id, title: course.title, to: `/catalog?course=${course._id}` })),
    announcements: announcements.map((row) => ({ id: row._id, title: row.title, to: '/announcements' })),
    users: users.map((row) => ({ id: row._id, title: row.name, subtitle: row.email, to: `/profile?member=${row._id}` })),
  })
}))

app.get('/api/notifications/me', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Notifications require MongoDB.' })
  const notifications = await Notification.find({ recipientId: req.auth.sub }).sort({ createdAt: -1 }).limit(100).lean()
  res.json(notifications)
}))

app.post('/api/notifications/:id/read', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Notifications require MongoDB.' })
  const notification = await Notification.findOneAndUpdate({ _id: req.params.id, recipientId: req.auth.sub }, { readAt: new Date() }, { new: true })
  if (!notification) return res.status(404).json({ error: 'Notification not found.' })
  res.json(notification)
}))

app.post('/api/notifications/read-all', requireAuth, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Notifications require MongoDB.' })
  await Notification.updateMany({ recipientId: req.auth.sub, readAt: { $exists: false } }, { readAt: new Date() })
  res.json({ ok: true })
}))

app.post('/api/staff/notifications', requireAuth, requireStaff, asyncRoute(async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: 'Notifications require MongoDB.' })
  const values = notificationBroadcastInput.parse(req.body)
  let recipientIds = values.recipientIds ?? []
  if (!recipientIds.length) {
    const roleFilter = values.audience === 'all_staff' ? { role: { $in: ['instructor', 'admin'] } } : values.audience === 'everyone' ? {} : { role: 'learner' }
    const recipients = await User.find({ ...roleFilter, status: 'active' }).select('_id').lean()
    recipientIds = recipients.map((recipient) => recipient._id)
  }
  const notifications = await Notification.insertMany(recipientIds.map((recipientId) => ({ recipientId, title: values.title, body: values.body, link: values.link })))
  await saveAudit('notification.broadcast', 'Notification', 'bulk', { count: notifications.length, title: values.title }, req.auth.sub)
  res.status(201).json({ count: notifications.length })
}))

app.post('/api/webhooks/docusign', asyncRoute(async (req, res) => {
  if (!config.docusign.webhookSecret || !verifyHmac(req.rawBody, req.header('x-docusign-signature-1'), config.docusign.webhookSecret)) return res.status(401).json({ error: 'Invalid DocuSign webhook signature.' })
  const eventId = req.body?.data?.envelopeId ?? req.body?.event ?? id()
  const exists = databaseReady && await WebhookEvent.exists({ provider: 'docusign', eventId })
  if (exists) return res.status(204).end()
  if (databaseReady) await WebhookEvent.create({ provider: 'docusign', eventId, eventType: req.body?.event, processedAt: new Date() })
  // Provider adapter: retrieve the completed envelope PDF and transition only a completed envelope to contract_signed.
  res.status(204).end()
}))

app.post('/api/webhooks/paymongo', asyncRoute(async (req, res) => {
  const signature = req.header('paymongo-signature') ?? req.header('x-paymongo-signature')
  const isLiveEvent = req.body?.data?.attributes?.livemode === true
  if (!config.paymongo.webhookSecret || !verifyPaymongoSignature(req.rawBody, signature, config.paymongo.webhookSecret, isLiveEvent)) return res.status(401).json({ error: 'Invalid PayMongo webhook signature.' })
  const event = req.body?.data
  const eventId = event?.id
  if (!eventId) return res.status(400).json({ error: 'Missing webhook event id.' })
  const exists = databaseReady && await WebhookEvent.exists({ provider: 'paymongo', eventId })
  if (exists) return res.status(204).end()
  const eventType = event?.attributes?.type
  const checkout = event?.attributes?.data
  if (eventType === 'checkout_session.payment.paid') {
    const referenceNumber = checkout?.attributes?.reference_number
    const checkoutId = checkout?.id
    let enrollment = null
    if (databaseReady) {
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
  if (databaseReady) await WebhookEvent.create({ provider: 'paymongo', eventId, eventType, processedAt: new Date() })
  res.status(204).end()
}))

app.get('/api/presence', asyncRoute(async (_req, res) => {
  if (!databaseReady) return res.json([...memory.presence.values()])
  const onlineSince = new Date(Date.now() - 90_000)
  const records = await Presence.find({ lastHeartbeatAt: { $gte: onlineSince } }).populate('userId', 'name role avatarUrl').lean()
  res.json(records.map(({ userId }) => userId).filter(Boolean))
}))

io.on('connection', (socket) => {
  socket.on('presence:heartbeat', async (profile) => {
    if (!profile?.id || !['learner', 'instructor', 'admin'].includes(profile.role)) return
    const record = { id: profile.id, name: profile.name, role: profile.role, avatarUrl: profile.avatarUrl, socketId: socket.id, lastHeartbeatAt: new Date() }
    memory.presence.set(profile.id, record)
    if (databaseReady && mongoose.isValidObjectId(profile.id)) await Presence.findOneAndUpdate({ userId: profile.id }, { socketId: socket.id, lastHeartbeatAt: record.lastHeartbeatAt }, { upsert: true })
    io.emit('presence:changed', [...memory.presence.values()])
  })
  socket.on('disconnect', () => {
    for (const [userId, entry] of memory.presence) if (entry.socketId === socket.id) memory.presence.delete(userId)
    io.emit('presence:changed', [...memory.presence.values()])
  })
})

app.use((error, _req, res, next) => {
  void next
  if (error instanceof z.ZodError) return res.status(422).json({ error: 'Please check the highlighted fields.', issues: error.issues })
  console.error(error)
  res.status(500).json({ error: 'Unexpected server error.' })
})

async function boot() {
  if (config.mongoUri) {
    await mongoose.connect(config.mongoUri)
    databaseReady = true
    await ensureDefaultEmailTemplates()
    console.log('MongoDB connected')
  } else if (isProduction) {
    throw new Error('MONGODB_URI is required in production.')
  } else {
    console.warn('MONGODB_URI is not set. Running with development-only in-memory records.')
  }
  server.listen(config.port, () => console.log(`Tree Academy API listening on :${config.port}`))
}

boot().catch((error) => { console.error(error); process.exit(1) })
