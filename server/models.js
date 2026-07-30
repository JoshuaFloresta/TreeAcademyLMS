import mongoose from 'mongoose'

const { Schema, model, models } = mongoose

const auditSchema = new Schema({
  actorId: { type: Schema.Types.ObjectId, ref: 'User' },
  action: { type: String, required: true },
  entityType: { type: String, required: true },
  entityId: { type: String, required: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true })

const userSchema = new Schema({
  name: { type: String, trim: true, required: true },
  email: { type: String, trim: true, lowercase: true, unique: true, required: true },
  username: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
  role: { type: String, enum: ['learner', 'instructor', 'admin'], default: 'learner' },
  status: { type: String, enum: ['invited', 'active', 'inactive', 'suspended'], default: 'invited' },
  passwordHash: String,
  mustChangePassword: { type: Boolean, default: false },
  avatarUrl: String,
  googleSubject: String,
  bio: { type: String, trim: true, maxlength: 600 },
  headline: { type: String, trim: true, maxlength: 120 },
  location: { type: String, trim: true, maxlength: 120 },
  // Seeded from the enrollment application at provisioning time (see provisionLearnerAccount) and
  // editable by the learner afterwards. Only blanks are seeded, so a learner's own edits survive a
  // second pathway approval. `birthDate` is treated as private — see publicProfile in index.js.
  birthDate: Date,
  school: { type: String, trim: true, maxlength: 200 },
  degree: { type: String, trim: true, maxlength: 200 },
  facebookUrl: { type: String, trim: true, maxlength: 300 },
  inviteTokenHash: String,
  inviteExpiresAt: Date,
  lastSeenAt: Date,
}, { timestamps: true })

const programSchema = new Schema({
  title: { type: String, required: true },
  audience: { type: String, required: true },
  description: String,
  benefits: [String],
  isPublished: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true })

const courseSchema = new Schema({
  title: { type: String, required: true },
  slug: { type: String, unique: true, required: true },
  programId: { type: Schema.Types.ObjectId, ref: 'Program' },
  description: String,
  isPublished: { type: Boolean, default: false },
  // Card art: either a named preset (rendered client-side from a fixed gallery) or an uploaded image URL.
  bannerPreset: String,
  bannerUrl: String,
  // Seasonal availability window — outside it a published course is hidden from learners/public.
  availableFrom: Date,
  availableUntil: Date,
  // Public landing page shows the live enrolled count unless an admin hides it.
  showEnrollmentCount: { type: Boolean, default: true },
  // Instructor-authored courses need admin sign-off before they can publish.
  approvalStatus: { type: String, enum: ['draft', 'pending_review', 'approved', 'rejected'], default: 'draft', index: true },
  reviewNote: String,
  archivedAt: Date,
  // An instructor may only author the catalogues explicitly assigned by an admin.
  assignedInstructorIds: [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
  // An optional admin-uploaded fillable/signable agreement PDF for courses outside the 3 fixed
  // enrollment pathways (which keep their own hardcoded realex-reblex/reclex documents). `fields`
  // is read straight off the PDF's own AcroForm at upload time (see extractAgreementFields in
  // enrollment-documents.js) rather than hand-authored, since the PDF is arbitrary per course.
  agreementTemplate: {
    fileKey: String,
    originalName: String,
    fields: [{
      name: String,
      type: { type: String, enum: ['text', 'checkbox', 'signature'] },
      multiline: Boolean,
      required: Boolean,
    }],
    uploadedAt: Date,
  },
}, { timestamps: true })

// The new authoring hierarchy is kept alongside the legacy phase/lesson models so existing
// learner catalogues remain available while courses are migrated.
const categorySchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 2000 },
  bannerPreset: String,
  bannerUrl: String,
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
  position: { type: Number, required: true },
}, { timestamps: true })

const categoryHeaderSchema = new Schema({
  categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  position: { type: Number, required: true },
}, { timestamps: true })

const learningModuleSchema = new Schema({
  headerId: { type: Schema.Types.ObjectId, ref: 'CategoryHeader', required: true, index: true },
  type: { type: String, enum: ['file', 'quiz', 'assignment'], required: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  instructions: { type: String, trim: true, maxlength: 5000 },
  resourceUrl: { type: String, trim: true, maxlength: 1000 },
  position: { type: Number, required: true },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
  quiz: { questions: [{ prompt: String, choices: [String], answerIndex: Number }], passingScore: Number },
  assignment: { maxPoints: Number, rubric: String, feedbackTemplate: String },
}, { timestamps: true })

const moduleSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  // A "module" is presented to learners as its own top-level review Phase card (Phase 1:
  // Foundations, etc.) — title is the phase name, description is its card blurb, phaseNumber is
  // instructor-customizable (falls back to position+1 in the UI).
  title: { type: String, required: true },
  description: String,
  phaseNumber: Number,
  position: { type: Number, required: true },
  isPublished: { type: Boolean, default: false },
}, { timestamps: true })

const lessonSchema = new Schema({
  moduleId: { type: Schema.Types.ObjectId, ref: 'Module', required: true },
  title: { type: String, required: true },
  // 'header' is a content-less divider used to group sections within a phase's list — it never
  // carries body/driveUrl and is skipped by learner-facing completion/progress logic.
  kind: { type: String, enum: ['article', 'video', 'document', 'link', 'header'], default: 'article' },
  body: String,
  resourceKey: String,
  // Instructor-editable link to an external resource (e.g. a Google Drive PDF) shown as a button
  // on the lesson row — separate from resourceKey, which addresses internally-stored files.
  driveUrl: String,
  position: { type: Number, required: true },
  isPublished: { type: Boolean, default: false },
}, { timestamps: true })

const assignmentSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  // Nests the assignment under a phase, and optionally a specific lesson within it, so the
  // catalog can show it inline where a learner is actually reading (Phase → Lesson → Assignment).
  moduleId: { type: Schema.Types.ObjectId, ref: 'Module', required: true },
  lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson' },
  title: { type: String, required: true },
  instructions: String,
  // Instructor-set link to instructions hosted elsewhere (e.g. a Google Drive PDF).
  instructionsUrl: String,
  dueAt: Date,
  maxPoints: { type: Number, default: 100 },
  // Lets an instructor restrict how learners may respond — a written response only, a file
  // upload only, or either — instead of always accepting both.
  submissionType: { type: String, enum: ['text', 'file', 'both'], default: 'both' },
  // Shared ordering space with sibling Lessons/Quizzes in the same phase (only meaningful for
  // module-level assignments — ones with no lessonId — so the course builder can interleave them
  // into one "Sections" list).
  position: { type: Number, default: 0 },
}, { timestamps: true })

const submissionSchema = new Schema({
  assignmentId: { type: Schema.Types.ObjectId, ref: 'Assignment', required: true },
  learnerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  body: String,
  attachmentKey: String,
  attachmentName: String,
  submittedAt: Date,
  grade: Number,
  feedback: String,
}, { timestamps: true })

// A comment hangs off exactly one of the two things a learner can hand in. `submissionId` stays
// optional-but-indexed rather than being folded into a generic target pair, so every comment
// written before quiz attempts existed keeps working untouched.
const submissionCommentSchema = new Schema({
  submissionId: { type: Schema.Types.ObjectId, ref: 'Submission', index: true },
  quizAttemptId: { type: Schema.Types.ObjectId, ref: 'QuizAttempt', index: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  authorRole: { type: String, enum: ['learner', 'instructor', 'admin'], required: true },
  body: { type: String, required: true, trim: true, maxlength: 4000 },
}, { timestamps: true })
// Declared with no `next` parameter on purpose — Mongoose then treats it as promise-based and a
// thrown error propagates normally. Taking `next` here fails at runtime under Mongoose 9.
submissionCommentSchema.pre('validate', function assertSingleTarget() {
  if (Boolean(this.submissionId) === Boolean(this.quizAttemptId)) throw new Error('A comment must belong to exactly one submission or quiz attempt.')
})

// Quiz attempts used to be graded in memory and discarded, which meant a learner could sit a quiz
// and leave no trace an instructor could review. Persisting them is what makes quizzes visible in
// the staff Submissions feed alongside assignment submissions.
const quizAttemptSchema = new Schema({
  quizId: { type: Schema.Types.ObjectId, ref: 'Quiz', required: true, index: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  learnerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // The learner's raw answers plus the per-question verdict, stored as given so an instructor can
  // see what was actually answered — not just the total. `correct: null` marks a question the
  // auto-grader can't judge (essay), which is exactly what a human needs to look at.
  answers: { type: Schema.Types.Mixed, default: [] },
  results: { type: Schema.Types.Mixed, default: [] },
  score: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  percent: { type: Number, default: 0 },
  // Set only when an instructor overrides the automatic result (e.g. after marking an essay).
  reviewedScore: Number,
  feedback: String,
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
  submittedAt: { type: Date, default: Date.now },
}, { timestamps: true })

const quizSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  // Optional (existing quizzes predate this field) — once set, the quiz is scoped to a phase and
  // shares that phase's Sections ordering space with its Lessons/Assignments.
  moduleId: { type: Schema.Types.ObjectId, ref: 'Module' },
  position: { type: Number, default: 0 },
  title: { type: String, required: true },
  // `type` picks which of the fields below apply — see quizQuestionInput in server/index.js for
  // the exact shape required per type. Auto-graded types: multiple_choice, true_false, fill_blank,
  // enumeration, matching. `essay` is self-review only (no auto-grading, no persisted attempt).
  questions: [{
    type: { type: String, enum: ['multiple_choice', 'true_false', 'fill_blank', 'essay', 'matching', 'enumeration'], default: 'multiple_choice' },
    prompt: String,
    choices: [String],
    answerIndex: Number,
    acceptableAnswers: [String],
    minAnswers: Number,
    pairs: [{ left: String, right: String }],
    explanation: String,
  }],
  isPublished: { type: Boolean, default: false },
}, { timestamps: true })

const enrollmentSchema = new Schema({
  applicant: {
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    phone: String,
    pathway: { type: String, enum: ['broker', 'consultant', 'appraiser'], required: true },
  },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'PHP' },
  status: {
    type: String,
    enum: ['application_pending', 'documents_pending', 'documents_complete', 'payment_pending', 'contract_pending', 'contract_signed', 'paid_approval_pending', 'approved', 'rejected', 'refunded'],
    default: 'application_pending',
    index: true,
  },
  intake: {
    data: { type: Schema.Types.Mixed, default: {} },
    submittedAt: Date,
    pdfKey: String,
  },
  documents: {
    realexReblex: { pdfKey: String, signedAt: Date, signatureName: String },
    reclex: { pdfKey: String, signedAt: Date, signatureName: String },
  },
  contract: { envelopeId: String, signedPdfKey: String, signedAt: Date },
  payment: {
    provider: String, transactionId: String, checkoutId: String, checkoutUrl: String, referenceNumber: String, paidAt: Date, refundedAt: Date,
    // `plan` records whether the learner chose to pay the full price or just the pathway's
    // upfront/reservation fee at checkout — `planAmount` is what was actually charged, so staff
    // can see the remaining balance (enrollment.amount - planAmount) and follow up manually.
    // TODO(remove before launch): drop 'test' once the temporary ₱1 test plan (see
    // server/index.js's payment-session route) is removed.
    plan: { type: String, enum: ['full', 'upfront', 'test'] },
    planAmount: Number,
  },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
  decisionReason: String,
  archivedAt: Date,
}, { timestamps: true })

// The generic, no-payment counterpart to Enrollment — for courses outside the 3 fixed pathways that
// carry their own admin-uploaded agreementTemplate (see Course above). A row only ever exists
// already-signed: it's created and filled in the same request (POST /api/course-agreements/:slug/apply),
// since there's no payment gate to wait on the way the pathway Enrollment state machine has.
const courseEnrollmentSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  applicant: {
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    phone: String,
  },
  document: { pdfKey: String, signedAt: Date, signatureName: String },
}, { timestamps: true })

// Singleton (admin edits the one document via findOneAndUpdate({}, ..., {upsert: true})) —
// replaces the hardcoded price in catalog.js so admins can adjust it without a deploy. Both the
// full price and the upfront reservation fee are independently editable per pathway/program —
// broker and appraiser enrollments sign the same "realex-reblex" agreement document, but that's a
// document-generation detail only (see enrollment-documents.js); pricing doesn't share their fee.
const pricingSettingsSchema = new Schema({
  totalBroker: { type: Number, required: true, default: 14900 },
  totalConsultant: { type: Number, required: true, default: 14900 },
  totalAppraiser: { type: Number, required: true, default: 14900 },
  currency: { type: String, default: 'PHP' },
  upfrontBroker: { type: Number, required: true, default: 1000 },
  upfrontConsultant: { type: Number, required: true, default: 5000 },
  upfrontAppraiser: { type: Number, required: true, default: 1000 },
}, { timestamps: true })

const calendarEventSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course' },
  title: { type: String, required: true },
  description: String,
  startsAt: { type: Date, required: true },
  endsAt: Date,
  eventType: { type: String, enum: ['live_review', 'deadline', 'announcement', 'office_hours'], default: 'live_review' },
  // Where the session actually happens — Zoom/Meet/Teams. Shown to learners as a "Join" button on
  // the event, so they don't have to hunt for the link in an announcement or an email.
  meetingUrl: String,
}, { timestamps: true })

// Roll-call for a single calendar session (live_review/office_hours) tied to a course — one row
// per enrolled learner per event, upserted in bulk when an instructor takes attendance.
const attendanceSchema = new Schema({
  eventId: { type: Schema.Types.ObjectId, ref: 'CalendarEvent', required: true, index: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  learnerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['present', 'absent', 'excused', 'late'], default: 'absent' },
  markedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  markedAt: Date,
}, { timestamps: true })
attendanceSchema.index({ eventId: 1, learnerId: 1 }, { unique: true })

const notificationSchema = new Schema({
  recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  body: String,
  link: String,
  readAt: Date,
}, { timestamps: true })

const newsletterSchema = new Schema({
  email: { type: String, unique: true, required: true, lowercase: true },
  status: { type: String, enum: ['pending', 'subscribed', 'unsubscribed'], default: 'pending' },
  consentedAt: Date,
  confirmationTokenHash: String,
}, { timestamps: true })

const presenceSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', unique: true, required: true },
  socketId: { type: String, required: true },
  lastHeartbeatAt: { type: Date, required: true },
}, { timestamps: true })

const webhookEventSchema = new Schema({
  provider: { type: String, required: true },
  eventId: { type: String, required: true },
  eventType: String,
  processedAt: Date,
}, { timestamps: true })
webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true })

const refreshTokenSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  impersonatorId: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

const badgeSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 400 },
  color: { type: String, default: '#B39255' },
  icon: { type: String, default: 'award' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

const studentBadgeSchema = new Schema({
  badgeId: { type: Schema.Types.ObjectId, ref: 'Badge', required: true },
  learnerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  // System-issued awards (via a BadgeRule) have no human awarder — required only for manual grants,
  // so this stays optional rather than pointing awardedBy at whichever instructor happened to
  // trigger the underlying event (they may not even teach that learner).
  awardedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  awardedByRuleId: { type: Schema.Types.ObjectId, ref: 'BadgeRule' },
  note: { type: String, trim: true, maxlength: 400 },
}, { timestamps: true })
studentBadgeSchema.index({ badgeId: 1, learnerId: 1 }, { unique: true })

// Instructor-defined "give this badge automatically when X happens" condition. Evaluated inline by
// runBadgeRules (server/index.js) from the handful of routes that can make a trigger newly true —
// grading, a quiz attempt/review, attendance, and module completion — rather than on a schedule,
// since the app has no background job runner and re-checking on every write for a small cohort is
// cheap.
const badgeRuleSchema = new Schema({
  badgeId: { type: Schema.Types.ObjectId, ref: 'Badge', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  trigger: {
    type: { type: String, enum: ['course_completion', 'module_milestone', 'score_threshold', 'attendance_count'], required: true },
    moduleId: { type: Schema.Types.ObjectId, ref: 'Module' }, // module_milestone
    targetKind: { type: String, enum: ['assignment', 'quiz'] }, // score_threshold
    targetId: Schema.Types.ObjectId, // score_threshold: the specific Assignment or Quiz
    minPercent: Number, // score_threshold
    minAttendance: Number, // attendance_count: sessions marked present/late
  },
  // Who is evaluated. 'course' is everyone the trigger event already concerns (the learner who was
  // just graded, marked present, etc.) — 'selected' narrows that to a hand-picked list, e.g. a
  // cohort or a subset the instructor wants to recognise even if others also meet the condition.
  targetScope: { type: String, enum: ['course', 'selected'], default: 'course' },
  learnerIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  isActive: { type: Boolean, default: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

const certificateTemplateSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  scope: { type: String, enum: ['module', 'program'], required: true },
  targetId: { type: Schema.Types.ObjectId, required: true },
  fileKey: { type: String, required: true },
  mimeType: { type: String, required: true },
  namePosition: { x: { type: Number, default: 260 }, y: { type: Number, default: 140 }, size: { type: Number, default: 30 } },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

const certificateSchema = new Schema({
  templateId: { type: Schema.Types.ObjectId, ref: 'CertificateTemplate', required: true },
  learnerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  recipientName: { type: String, required: true },
  targetId: { type: Schema.Types.ObjectId, required: true },
  fileKey: { type: String, required: true },
  issuedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
certificateSchema.index({ templateId: 1, learnerId: 1 }, { unique: true })

const learningProgressSchema = new Schema({
  learnerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  completedModuleIds: [{ type: Schema.Types.ObjectId, ref: 'Module' }],
  completedAt: Date,
}, { timestamps: true })
learningProgressSchema.index({ learnerId: 1, courseId: 1 }, { unique: true })

const supportTicketSchema = new Schema({
  requesterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  subject: { type: String, required: true, trim: true, maxlength: 160 },
  category: { type: String, enum: ['account', 'billing', 'technical', 'course', 'other'], default: 'other' },
  message: { type: String, required: true, trim: true, maxlength: 4000 },
  status: { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open', index: true },
  priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
  response: { type: String, trim: true, maxlength: 4000 },
  handledBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

const reportSchema = new Schema({
  reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  reporterRole: { type: String, enum: ['learner', 'instructor', 'admin'], required: true },
  type: { type: String, enum: ['progress', 'issue', 'feedback', 'incident', 'other'], default: 'other' },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  details: { type: String, required: true, trim: true, maxlength: 4000 },
  status: { type: String, enum: ['submitted', 'reviewing', 'actioned', 'dismissed'], default: 'submitted', index: true },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewNote: { type: String, trim: true, maxlength: 2000 },
}, { timestamps: true })

const contentAssetSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 1000 },
  category: { type: String, enum: ['template', 'document', 'video', 'image', 'link', 'other'], default: 'other' },
  url: { type: String, trim: true, maxlength: 1000 },
  tags: [String],
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

const announcementSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  body: { type: String, required: true, trim: true, maxlength: 4000 },
  pinned: { type: Boolean, default: false },
}, { timestamps: true })

const forumThreadSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  body: { type: String, required: true, trim: true, maxlength: 6000 },
  imageUrl: { type: String },
  isPinned: { type: Boolean, default: false },
  isLocked: { type: Boolean, default: false },
  lastPostAt: { type: Date, default: Date.now },
  viewCount: { type: Number, default: 0 },
}, { timestamps: true })

const forumPostSchema = new Schema({
  threadId: { type: Schema.Types.ObjectId, ref: 'ForumThread', required: true, index: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, required: true, trim: true, maxlength: 6000 },
  imageUrl: { type: String },
  editedAt: { type: Date },
}, { timestamps: true })

// One reaction per learner per thread — switching between like/dislike overwrites the row rather
// than adding a second one; the unique index is what makes that swap (and re-clicking to undo)
// safe under concurrent requests.
const forumReactionSchema = new Schema({
  threadId: { type: Schema.Types.ObjectId, ref: 'ForumThread', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['like', 'dislike'], required: true },
}, { timestamps: true })
forumReactionSchema.index({ threadId: 1, userId: 1 }, { unique: true })

const webinarSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 2000 },
  startsAt: { type: Date, required: true },
  // Registration closes here; defaults to startsAt when omitted.
  registrationDeadline: Date,
  capacity: { type: Number, min: 1 },
  isPublished: { type: Boolean, default: false },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

const webinarRegistrationSchema = new Schema({
  webinarId: { type: Schema.Types.ObjectId, ref: 'Webinar', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
}, { timestamps: true })
webinarRegistrationSchema.index({ webinarId: 1, email: 1 }, { unique: true })

const emailTemplateSchema = new Schema({
  key: { type: String, enum: ['enrollment_received', 'webinar_registration', 'enrollment_credentials', 'payment_receipt'], unique: true, required: true },
  subject: { type: String, required: true, trim: true, maxlength: 200 },
  body: { type: String, required: true, trim: true, maxlength: 20000 },
  fromName: { type: String, trim: true, maxlength: 100, default: '' },
  fromEmail: { type: String, trim: true, maxlength: 254, default: '' },
  enabled: { type: Boolean, default: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

const rolePermissionSchema = new Schema({
  role: { type: String, enum: ['learner', 'instructor', 'admin'], unique: true, required: true },
  permissions: { type: [String], default: [] },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

export const User = models.User || model('User', userSchema)
export const Program = models.Program || model('Program', programSchema)
export const Course = models.Course || model('Course', courseSchema)
export const Category = models.Category || model('Category', categorySchema)
export const CategoryHeader = models.CategoryHeader || model('CategoryHeader', categoryHeaderSchema)
export const LearningModule = models.LearningModule || model('LearningModule', learningModuleSchema)
export const Module = models.Module || model('Module', moduleSchema)
export const Lesson = models.Lesson || model('Lesson', lessonSchema)
export const Assignment = models.Assignment || model('Assignment', assignmentSchema)
export const Submission = models.Submission || model('Submission', submissionSchema)
export const SubmissionComment = models.SubmissionComment || model('SubmissionComment', submissionCommentSchema)
export const Quiz = models.Quiz || model('Quiz', quizSchema)
export const QuizAttempt = models.QuizAttempt || model('QuizAttempt', quizAttemptSchema)
export const Enrollment = models.Enrollment || model('Enrollment', enrollmentSchema)
export const CourseEnrollment = models.CourseEnrollment || model('CourseEnrollment', courseEnrollmentSchema)
export const PricingSettings = models.PricingSettings || model('PricingSettings', pricingSettingsSchema)
export const CalendarEvent = models.CalendarEvent || model('CalendarEvent', calendarEventSchema)
export const Attendance = models.Attendance || model('Attendance', attendanceSchema)
export const Notification = models.Notification || model('Notification', notificationSchema)
export const NewsletterSubscriber = models.NewsletterSubscriber || model('NewsletterSubscriber', newsletterSchema)
export const Presence = models.Presence || model('Presence', presenceSchema)
export const WebhookEvent = models.WebhookEvent || model('WebhookEvent', webhookEventSchema)
export const AuditLog = models.AuditLog || model('AuditLog', auditSchema)
export const RefreshToken = models.RefreshToken || model('RefreshToken', refreshTokenSchema)
export const Badge = models.Badge || model('Badge', badgeSchema)
export const StudentBadge = models.StudentBadge || model('StudentBadge', studentBadgeSchema)
export const BadgeRule = models.BadgeRule || model('BadgeRule', badgeRuleSchema)
export const CertificateTemplate = models.CertificateTemplate || model('CertificateTemplate', certificateTemplateSchema)
export const Certificate = models.Certificate || model('Certificate', certificateSchema)
export const LearningProgress = models.LearningProgress || model('LearningProgress', learningProgressSchema)
export const SupportTicket = models.SupportTicket || model('SupportTicket', supportTicketSchema)
export const Report = models.Report || model('Report', reportSchema)
export const ContentAsset = models.ContentAsset || model('ContentAsset', contentAssetSchema)
export const RolePermission = models.RolePermission || model('RolePermission', rolePermissionSchema)
export const Announcement = models.Announcement || model('Announcement', announcementSchema)
export const ForumThread = models.ForumThread || model('ForumThread', forumThreadSchema)
export const ForumPost = models.ForumPost || model('ForumPost', forumPostSchema)
export const ForumReaction = models.ForumReaction || model('ForumReaction', forumReactionSchema)
export const Webinar = models.Webinar || model('Webinar', webinarSchema)
export const WebinarRegistration = models.WebinarRegistration || model('WebinarRegistration', webinarRegistrationSchema)
export const EmailTemplate = models.EmailTemplate || model('EmailTemplate', emailTemplateSchema)
