import mongoose from 'mongoose'
import { config } from './config.js'
import { Assignment, CalendarEvent, Course, Lesson, Module, Notification, Program, Quiz, User } from './models.js'

// Seeds real LMS course content (programs, courses, modules, lessons, assignments, quizzes,
// calendar events, and welcome notifications) so the learner-facing pages have genuine data
// instead of the placeholder arrays that used to live in src/lib/academyData.js. Safe to re-run:
// courses/modules/assignments are upserted by a stable key (slug / courseId+title), preserving
// their _id so learner progress and submissions are never orphaned; only lessons and quizzes,
// which nothing else references by id, are fully replaced.
const day = 24 * 60 * 60 * 1000

const programs = [
  { slug: 'broker-review', title: 'Broker Review', audience: 'Licensed brokers preparing for the board exam', description: 'Build a bulletproof foundation for your brokerage career — legal knowledge, ethical standards, and operational practice for the Broker board exam.' },
  { slug: 'consultant-review', title: 'Consultant Review', audience: 'Advisors preparing for the Real Estate Consultant exam', description: 'Deep-dive into advisory practice, market research, financial modeling, and feasibility studies for the Consultant licensure exam.' },
  { slug: 'agent-review', title: 'Agent Review', audience: 'Rising practitioners preparing for agent accreditation', description: 'Master property practice fundamentals with hands-on guidance and real-world case discussions.' },
]

const courseBlueprints = [
  {
    slug: 'broker-review', programSlug: 'broker-review', title: 'Broker Review',
    description: 'Twelve modules covering the full REBLEX board-exam syllabus, from valuation to brokerage law.',
    modules: [
      { title: 'Orientation & Study Planning', description: 'Get oriented to the review calendar, build your personal study plan, and learn how to navigate the module library before diving into content.', lessons: [
        { title: 'Welcome to Broker Review', kind: 'article', body: 'An overview of the 12-week review calendar, live-session schedule, and how to use the module library.' },
        { title: 'Building your study plan', kind: 'article', body: 'Set a weekly study cadence and identify your weaker subject areas before diving into content.' },
      ] },
      { title: 'Valuation Fundamentals', description: 'Master the three core valuation approaches — cost, market comparison, and income capitalization — and practice applying them to real listing data.', lessons: [
        { title: 'Reading property value with confidence', kind: 'video', body: 'Core valuation approaches: cost, market comparison, and income capitalization.' },
        { title: 'Practice: comparative market analysis', kind: 'article', body: 'Walk through a full CMA worksheet using sample listing data.' },
      ] },
      { title: 'Legal Framework & Ethics', description: 'Study RESA (RA 9646) essentials and work through real-world ethical dilemmas brokers face with clients and co-brokers.', lessons: [
        { title: 'RESA law and IRR essentials', kind: 'article', body: 'Key provisions of RA 9646 every licensed broker must know cold.' },
        { title: 'Professional ethics case studies', kind: 'article', body: 'Work through common ethical dilemmas brokers face with clients and co-brokers.' },
      ] },
      { title: 'Brokerage Operations', description: 'Learn the operational side of running a compliant brokerage: recordkeeping, escrow handling, and agency-agreement requirements.', lessons: [
        { title: 'Running a compliant brokerage', kind: 'document', body: 'Recordkeeping, escrow handling, and agency-agreement requirements.' },
      ] },
    ],
    assignments: [
      { title: 'Property valuation practice set', moduleTitle: 'Valuation Fundamentals', instructions: 'Complete the attached comparative market analysis worksheet and submit your findings.', dueOffsetDays: 2, maxPoints: 100 },
      { title: 'Agency disclosure worksheet', moduleTitle: 'Legal Framework & Ethics', instructions: 'Draft a disclosure statement for the sample dual-agency scenario.', dueOffsetDays: 9, maxPoints: 50 },
    ],
    quiz: {
      title: 'Property valuation fundamentals — practice set 04',
      questions: [
        { prompt: 'Which valuation approach relies primarily on recent comparable sales?', choices: ['Cost approach', 'Market comparison approach', 'Income capitalization approach', 'Replacement approach'], answerIndex: 1, explanation: 'The market comparison approach derives value from recent sales of similar properties.' },
        { prompt: 'Under RESA (RA 9646), who may legally negotiate the sale of real property for a fee?', choices: ['Any licensed accountant', 'A duly licensed and registered real estate broker', 'Any notary public', 'A property caretaker'], answerIndex: 1, explanation: 'Only licensed and PRC-registered real estate brokers may lawfully negotiate real-estate transactions for a fee.' },
        { prompt: 'Capitalization rate is most closely associated with which valuation approach?', choices: ['Market comparison approach', 'Cost approach', 'Income capitalization approach', 'Replacement cost approach'], answerIndex: 2, explanation: 'Cap rate converts expected income into an estimate of present value under the income approach.' },
        { prompt: 'A dual agency situation requires which of the following?', choices: ['No disclosure needed if both parties are represented by the same brokerage', 'Full written disclosure and informed consent from both parties', 'Only verbal disclosure to the buyer', 'Disclosure only if requested'], answerIndex: 1, explanation: 'Dual agency requires full written disclosure and informed consent from both principals.' },
        { prompt: 'Which of the following is NOT typically a component of a comparative market analysis?', choices: ['Recent comparable sales', 'Property condition adjustments', 'The broker’s personal commission rate', 'Days-on-market trends'], answerIndex: 2, explanation: 'A broker’s commission rate has no bearing on estimating a property’s market value.' },
      ],
    },
  },
  {
    slug: 'consultant-review', programSlug: 'consultant-review', title: 'Consultant Review',
    description: 'Ten modules on advisory practice, financial modeling, and feasibility-study preparation for the Consultant exam.',
    modules: [
      { title: 'Advisory Practice Foundations', description: 'Understand what sets a consultant apart from a broker and build a structured framework for client discovery conversations.', lessons: [
        { title: 'What sets a consultant apart', kind: 'article', body: 'Scope of practice, client relationships, and the consultant’s advisory role versus a broker’s transactional role.' },
        { title: 'Client consultation frameworks', kind: 'video', body: 'A structured approach to running a client discovery conversation.' },
      ] },
      { title: 'Market Research & Feasibility', description: 'Work through the market, technical, financial, and socio-economic components of a full project feasibility study.', lessons: [
        { title: 'Project feasibility studies, step by step', kind: 'document', body: 'Market, technical, financial, and socio-economic feasibility components.' },
        { title: 'Risk sensitivity testing', kind: 'article', body: 'Stress-testing a feasibility model against interest-rate and absorption-rate shocks.' },
      ] },
      { title: 'Financial Modeling', description: 'Build a discounted cash flow model for a mixed-use development scenario from the ground up.', lessons: [
        { title: 'Building a discounted cash flow model', kind: 'video', body: 'Constructing a DCF for a mixed-use development scenario.' },
      ] },
    ],
    assignments: [
      { title: 'Client consultation reflection', moduleTitle: 'Advisory Practice Foundations', instructions: 'Reflect on a mock client consultation and identify two advisory gaps you would address.', dueOffsetDays: 5, maxPoints: 100 },
      { title: 'Market positioning mini-case', moduleTitle: 'Market Research & Feasibility', instructions: 'Prepare a one-page market positioning brief for the assigned case property.', dueOffsetDays: 12, maxPoints: 75 },
    ],
    quiz: {
      title: 'Feasibility study essentials',
      questions: [
        { prompt: 'A project feasibility study typically evaluates all of the following EXCEPT:', choices: ['Market feasibility', 'Technical feasibility', 'The broker’s personal preference for the site', 'Financial feasibility'], answerIndex: 2, explanation: 'Feasibility studies are evaluated on objective market, technical, and financial criteria, not personal preference.' },
        { prompt: 'Risk sensitivity testing in financial modeling is used to:', choices: ['Guarantee investment returns', 'Assess how outcomes change under varying assumptions', 'Replace the need for a market study', 'Set the final selling price'], answerIndex: 1, explanation: 'Sensitivity testing shows how sensitive a model’s outcome is to changes in key assumptions.' },
        { prompt: 'Discounted cash flow (DCF) analysis primarily measures:', choices: ['The historical cost of the property', 'The present value of future expected cash flows', 'The replacement cost of improvements', 'The assessed value for tax purposes'], answerIndex: 1, explanation: 'DCF discounts projected future cash flows back to their present value.' },
      ],
    },
  },
  {
    slug: 'agent-review', programSlug: 'agent-review', title: 'Agent Review',
    description: 'Nine modules covering property practice fundamentals, market analysis, and client service for accreditation.',
    modules: [
      { title: 'Property Practice Basics', description: 'Learn the agent’s role in a transaction and how to structure a confident, client-ready listing presentation.', lessons: [
        { title: 'The agent’s role in a transaction', kind: 'article', body: 'How an accredited salesperson supports a broker through a transaction.' },
        { title: 'Listing presentation essentials', kind: 'video', body: 'Structuring a confident, client-ready listing presentation.' },
      ] },
      { title: 'Client Service & Communication', description: 'Practice handling common client objections with practical, real-world response frameworks.', lessons: [
        { title: 'Handling objections with confidence', kind: 'article', body: 'Common client objections and practical response frameworks.' },
      ] },
      { title: 'Mock Exam Preparation', description: 'Sharpen your time-management and question-triage strategy ahead of the accreditation exam.', lessons: [
        { title: 'Mock exam strategy', kind: 'document', body: 'Time management and question-triage strategy for the accreditation exam.' },
      ] },
    ],
    assignments: [
      { title: 'Listing presentation practice', moduleTitle: 'Property Practice Basics', instructions: 'Record or outline a 5-minute listing presentation for the assigned sample property.', dueOffsetDays: 4, maxPoints: 100 },
    ],
    quiz: {
      title: 'Property practice fundamentals',
      questions: [
        { prompt: 'An accredited salesperson may legally close a sale transaction:', choices: ['Independently, without broker supervision', 'Only under the supervision of a licensed broker', 'Only for properties they personally own', 'Without any licensing requirement'], answerIndex: 1, explanation: 'Accredited salespersons must operate under the supervision of a duly licensed real estate broker.' },
        { prompt: 'The best response to a client price objection is generally to:', choices: ['Immediately lower the price', 'Present supporting market data and address the underlying concern', 'End the conversation', 'Avoid discussing price at all'], answerIndex: 1, explanation: 'Grounding the conversation in market data addresses objections credibly without an immediate concession.' },
      ],
    },
  },
]

const calendarEvents = [
  { title: 'Market insights clinic', description: 'Live review session covering current market trends relevant to all three pathways.', eventType: 'live_review', startOffsetDays: 0, durationHours: 3 },
  { title: 'Consultant case review', description: 'Live case-review session for Consultant Review learners.', eventType: 'live_review', startOffsetDays: 2, durationHours: 2, courseSlug: 'consultant-review' },
  { title: 'Property valuation practice set due', description: 'Submission deadline for the Broker Review valuation worksheet.', eventType: 'deadline', startOffsetDays: 2, courseSlug: 'broker-review' },
  { title: 'Q&A session with instructors', description: 'Open Q&A across all pathways.', eventType: 'live_review', startOffsetDays: 6, durationHours: 1 },
  { title: 'August live-review schedule is now available', description: 'The full August live-session calendar has been published — save your preferred sessions.', eventType: 'announcement', startOffsetDays: 1 },
  { title: 'Practice resources are ready', description: 'New valuation practice examples have been added to the Broker Review module library.', eventType: 'announcement', startOffsetDays: -1, courseSlug: 'broker-review' },
]

async function upsertCourse(blueprint) {
  const programBlueprint = programs.find((program) => program.slug === blueprint.programSlug)
  const program = await Program.findOneAndUpdate(
    { title: programBlueprint.title },
    { title: programBlueprint.title, audience: programBlueprint.audience, description: programBlueprint.description, isPublished: true },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )

  const course = await Course.findOneAndUpdate(
    { slug: blueprint.slug },
    { title: blueprint.title, slug: blueprint.slug, programId: program._id, description: blueprint.description, isPublished: true },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )

  // Modules are upserted by (courseId, title) rather than wiped and recreated, so a module's _id
  // stays stable across reseeds — LearningProgress.completedModuleIds references it directly, and
  // recreating the doc would silently strand every learner's completed-phase history.
  const moduleByTitle = new Map()
  for (const [moduleIndex, moduleBlueprint] of blueprint.modules.entries()) {
    const module = await Module.findOneAndUpdate(
      { courseId: course._id, title: moduleBlueprint.title },
      { courseId: course._id, title: moduleBlueprint.title, description: moduleBlueprint.description, phaseNumber: moduleIndex + 1, position: moduleIndex, isPublished: true },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    )
    moduleByTitle.set(moduleBlueprint.title, module)
    await Lesson.deleteMany({ moduleId: module._id })
    for (const [lessonIndex, lessonBlueprint] of moduleBlueprint.lessons.entries()) {
      await Lesson.create({ moduleId: module._id, title: lessonBlueprint.title, kind: lessonBlueprint.kind, body: lessonBlueprint.body, position: lessonIndex, isPublished: true })
    }
  }

  // Same reasoning for assignments — Submission.assignmentId is a hard reference, so upsert by
  // (courseId, title) instead of deleting, to avoid orphaning a learner's graded submissions.
  for (const assignmentBlueprint of blueprint.assignments) {
    const module = moduleByTitle.get(assignmentBlueprint.moduleTitle)
    await Assignment.findOneAndUpdate(
      { courseId: course._id, title: assignmentBlueprint.title },
      { courseId: course._id, moduleId: module._id, title: assignmentBlueprint.title, instructions: assignmentBlueprint.instructions, dueAt: new Date(Date.now() + assignmentBlueprint.dueOffsetDays * day), maxPoints: assignmentBlueprint.maxPoints },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    )
  }

  await Quiz.deleteMany({ courseId: course._id })
  await Quiz.create({ courseId: course._id, title: blueprint.quiz.title, questions: blueprint.quiz.questions, isPublished: true })

  return course
}

async function seedContent() {
  if (!config.mongoUri) {
    console.error('MONGODB_URI is not set. Seeding content requires a real database connection.')
    process.exitCode = 1
    return
  }

  await mongoose.connect(config.mongoUri)

  const coursesBySlug = new Map()
  for (const blueprint of courseBlueprints) {
    const course = await upsertCourse(blueprint)
    coursesBySlug.set(blueprint.slug, course)
    console.log(`Seeded course "${course.title}" (${blueprint.modules.length} modules, ${blueprint.assignments.length} assignments, 1 quiz).`)
  }

  await CalendarEvent.deleteMany({})
  for (const event of calendarEvents) {
    const startsAt = new Date(Date.now() + event.startOffsetDays * day)
    const endsAt = event.durationHours ? new Date(startsAt.getTime() + event.durationHours * 60 * 60 * 1000) : undefined
    await CalendarEvent.create({ title: event.title, description: event.description, eventType: event.eventType, startsAt, endsAt, courseId: event.courseSlug ? coursesBySlug.get(event.courseSlug)?._id : undefined })
  }
  console.log(`Seeded ${calendarEvents.length} calendar events.`)

  const learners = await User.find({ role: 'learner', status: 'active' }).select('_id name').lean()
  if (learners.length) {
    await Notification.deleteMany({ title: 'Welcome to Tree Academy' })
    await Notification.insertMany(learners.map((learner) => ({ recipientId: learner._id, title: 'Welcome to Tree Academy', body: 'Your learning space is ready — start with your pathway’s Orientation module in the Modules catalog.', link: '/catalog' })))
    console.log(`Sent a welcome notification to ${learners.length} learner${learners.length === 1 ? '' : 's'}.`)
  } else {
    console.log('No active learners found yet — skipped welcome notifications. Run npm run seed:dummy first if you want sample recipients.')
  }

  await mongoose.disconnect()
  console.log('\nContent seed complete.')
}

seedContent().catch((error) => {
  console.error('Content seed failed:', error)
  process.exitCode = 1
})
