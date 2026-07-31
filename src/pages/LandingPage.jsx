import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowDownRight, ArrowRight, CalendarClock, Check, CheckCircle2, ChevronRight, ClipboardCheck, FileSignature, Mail, MoreHorizontal, Play, Users, Zap } from 'lucide-react'
import PublicHeader from '../components/PublicHeader.jsx'
import PublicFooter from '../components/PublicFooter.jsx'
import NewsletterForm from '../components/NewsletterForm.jsx'
import PrimaryButton from '../components/PrimaryButton.jsx'
import StatusPill from '../components/StatusPill.jsx'
import Modal from '../components/Modal.jsx'
import ProgramCard from '../components/landing/ProgramCard.jsx'
import HowStep from '../components/landing/HowStep.jsx'
import Instructors from '../components/Instructor.jsx'
import Syllabus from '../components/Syllabus.jsx'
import PassFirst from '../components/PassFirst.jsx'
import Testimonials from '../components/Testimonials.jsx'
import { blockedPathwayMessage, faq, pathways } from '../lib/academyData.js'
import { fetchPathwayStats, fetchPublicWebinars, registerForWebinar } from '../lib/publicCatalog.js'

const webinarDeadlineLabel = (webinar) => {
  const deadline = new Date(webinar.registrationDeadline ?? webinar.startsAt)
  return `Registration closes ${deadline.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
}

function WebinarRegisterModal({ webinar, onClose }) {
  const [values, setValues] = useState({ name: '', email: '' })
  const mutation = useMutation({ mutationFn: () => registerForWebinar(webinar.id, values) })
  const submit = (event) => { event.preventDefault(); mutation.mutate() }

  return <Modal open={Boolean(webinar)} onClose={onClose} labelledBy="webinar-register-title">
    {mutation.isSuccess
      ? <><span className="enrollment-sent-badge"><CheckCircle2 size={30} /></span><p className="eyebrow">REGISTERED</p><h2 id="webinar-register-title">You’re all set<br /><em>for {webinar?.title}.</em></h2><p className="enrollment-sent-lead">A confirmation email is on its way to {values.email}.</p></>
      : <>
        <p className="eyebrow">REGISTER NOW</p>
        <h2 id="webinar-register-title">{webinar?.title}</h2>
        <p className="enrollment-sent-lead">{webinar?.description || 'Save your seat for this session.'}</p>
        <form className="webinar-register-form" onSubmit={submit}>
          <input required placeholder="Full name" value={values.name} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} />
          <input required type="email" placeholder="Email address" value={values.email} onChange={(event) => setValues((current) => ({ ...current, email: event.target.value }))} />
          {mutation.isError && <p className="form-alert" role="alert">{mutation.error.message}</p>}
          <button className="button button-primary" type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Registering…' : 'Confirm my seat'}</button>
        </form>
      </>}
  </Modal>
}

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState(0)
  const [modalPathwayId, setModalPathwayId] = useState(null)
  // On phones (≤480px) the program modal shows one card at a time: green copy first, then the cream price card.
  const [modalStep, setModalStep] = useState('copy')
  const openPathwayModal = (id) => { setModalStep('copy'); setModalPathwayId(id) }
  const [registeringWebinar, setRegisteringWebinar] = useState(null)
  const { data: pathwayStats = {} } = useQuery({ queryKey: ['public-pathway-stats'], queryFn: fetchPathwayStats, staleTime: 60_000 })
  const { data: webinars = [] } = useQuery({ queryKey: ['public-webinars'], queryFn: fetchPublicWebinars, staleTime: 60_000 })
  const modalPathway = pathways.find((pathway) => pathway.id === modalPathwayId)
  const ModalPathwayIcon = modalPathway?.icon
  const modalStats = modalPathwayId ? pathwayStats[modalPathwayId] : null
  const modalBlockedMessage = blockedPathwayMessage(modalStats)

  return (
    <div className="public-page">
      <PublicHeader />
      <main>
        {/* Hero Section */}
        <section className="hero-section shell">
          <div className="hero-copy">
            <StatusPill>PASS FIRST, REVIEW PROGRAM </StatusPill>
            <h1>Train in Real Estate <em>Excellence.</em></h1>
            <p className="lead">TREE Academy for Real Estate Excellence is a professional education and training institution dedicated to developing competent, ethical, technology-ready, and practice-oriented real estate professionals.</p>
            <div className="hero-actions">
              <PrimaryButton to="/enroll">Explore all-access</PrimaryButton>
              <a className="text-link" href="#programs">Browse programs <ArrowDownRight size={17} /></a>
            </div>
            <div className="trust-row">
              <div className="avatars"><span>MC</span><span>AR</span><span>JL</span><span>+2k</span></div>
              <p>Join a growing community of <strong>1,000+ real estate professionals.</strong></p>
            </div>
          </div>
          <div className="hero-art" aria-label="Learner progress preview">
            <div className="hero-grid" />
            <div className="hero-card course-preview">
              <div className="card-top"><span className="mini-logo">ta</span><MoreHorizontal size={19} /></div>
              <p className="eyebrow">YOUR LEARNING PATH</p>
              <h3>Broker Review</h3>
              <div className="preview-line"><span>8 of 12 modules complete</span><strong>67%</strong></div>
              <div className="progress"><span style={{ width: '67%' }} /></div>
              <div className="lesson-row">
                <div className="play-circle"><Play size={13} fill="currentColor" /></div>
                <div><strong>Property valuation</strong><small>Next lesson · 18 mins</small></div>
                <ChevronRight size={18} />
              </div>
            </div>
      <div className="hero-card score-card">
        <span className="score-label">EXAM READINESS</span>
        <strong style={{ fontSize: '1.8rem' }}>HIGH</strong>
        <p>Targeted for licensure</p>
        <Check size={16} />
        </div>

            <div className="hero-card mentor-card">
              <div className="avatar sage">MS</div>
              <div><span>YOUR INSTRUCTOR</span><strong>William L. Floresta</strong><small>Online now</small></div>
              <span className="online-dot" />
            </div>
          </div>
        </section>

        {/* Marquee Section */}
        <section className="marquee" aria-label="Learning outcomes">
       <div className="marquee-content">
         <span>PREPARE WITH PURPOSE</span><i>✦</i>
         <span>PRACTICE WITH PEERS</span><i>✦</i>
          <span>PROGRESS WITH CLARITY</span><i>✦</i>
      </div>
        <div className="marquee-content" aria-hidden="true">
         <span>PREPARE WITH PURPOSE</span><i>✦</i>
        <span>PRACTICE WITH PEERS</span><i>✦</i>
        <span>PROGRESS WITH CLARITY</span><i>✦</i>
       </div>
       
       
      </section>


        <PassFirst />
        <Syllabus />
        <Instructors />

        {/* Programs Section */}
        <section id="programs" className="programs shell section">
          <div className="section-heading">
            <div><p className="eyebrow">BUILT FOR YOUR NEXT STEP</p><h2>Three pathways.<br /><em>One complete learning home.</em></h2></div>
            <p className="section-copy">Choose the pathway that speaks to where you are today. All-access enrollment gives you room to explore every one.</p>
          </div>
          <div className="program-grid">
            {pathways.map((pathway) => <ProgramCard key={pathway.id} pathway={pathway} stats={pathwayStats[pathway.id]} onSelect={openPathwayModal} />)}
          </div>
        </section>

        {/* Program details — opens as a modal for the selected pathway, no separate section */}
        <Modal open={Boolean(modalPathway)} onClose={() => setModalPathwayId(null)} labelledBy="program-modal-title" className="program-modal">
          {modalPathway && <section className={`access-section mobile-step-${modalStep}`}>
            <div className="access-copy">
              <StatusPill kind="gold">{modalPathway.kicker}</StatusPill>
              <h2 id="program-modal-title">{modalPathway.title}<br /><em>built for your next step.</em></h2>
              <p>{modalPathway.details}</p>
              <ul>
                {modalPathway.features.map((feature) => <li key={feature}><Check /> {feature}</li>)}
              </ul>
              {modalBlockedMessage
                ? <p className="program-modal-blocked-note program-modal-desktop-cta">{modalBlockedMessage}</p>
                : <PrimaryButton to={`/enroll?pathway=${modalPathway.id}`} className="program-modal-desktop-cta">Review agreement &amp; enroll</PrimaryButton>}
              <button type="button" className="button button-primary program-modal-next" onClick={() => setModalStep('price')}>Next <ArrowRight size={17} /></button>
            </div>
            <div className="access-price">
              <div className="price-sticker">{modalPathway.examTag}</div>
              <p className="eyebrow">LICENSURE REVIEW · {modalPathway.duration}</p>
              <div className="price">{modalPathway.price}<span>PHP</span></div>
              <p>{modalPathway.upfrontFee}</p>
              <div className="price-divider" />
              <div className="price-feature">
                <span><ModalPathwayIcon /></span>
                <div><strong>{modalPathway.title}</strong><small>{modalPathway.kicker} · {modalPathway.examTag}</small></div>
              </div>
              <div className="program-modal-mobile-cta">
                {modalBlockedMessage
                  ? <p className="program-modal-blocked-note">{modalBlockedMessage}</p>
                  : <PrimaryButton to={`/enroll?pathway=${modalPathway.id}`}>Review agreement &amp; enroll</PrimaryButton>}
                <button type="button" className="program-modal-back" onClick={() => setModalStep('copy')}>Back to overview</button>
              </div>
            </div>
          </section>}
        </Modal>

        {/* Special courses & webinars — disappear automatically once past the deadline or full */}
        {webinars.length > 0 && <section id="webinars" className="webinars shell section">
          <div className="section-heading">
            <div><p className="eyebrow">LIMITED-TIME SESSIONS</p><h2>Special courses <br /><em>and live webinars.</em></h2></div>
            <p className="section-copy">Seasonal masterclasses and live sessions with limited seats. Once the date passes or seats run out, they’re gone.</p>
          </div>
          <div className="webinar-grid">
            {webinars.map((webinar) => {
              const seatsLeft = webinar.capacity != null ? webinar.capacity - webinar.registeredCount : null
              return <article className={`webinar-card ${seatsLeft != null && seatsLeft <= 5 ? 'filling-fast' : ''}`} key={webinar.id}>
                <div className="webinar-head">
                  <StatusPill kind={seatsLeft != null && seatsLeft <= 5 ? 'gold' : 'green'}>{seatsLeft != null && seatsLeft <= 5 ? 'Filling fast' : 'Open'}</StatusPill>
                  {seatsLeft != null && <span className="webinar-seats"><Users size={13} /> {seatsLeft} seat{seatsLeft === 1 ? '' : 's'} left</span>}
                </div>
                <h3>{webinar.title}</h3>
                {webinar.description && <p>{webinar.description}</p>}
                <small><CalendarClock size={13} /> {new Date(webinar.startsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · {webinarDeadlineLabel(webinar)}</small>
                <button type="button" className="button button-primary" onClick={() => setRegisteringWebinar(webinar)}>Register</button>
              </article>
            })}
          </div>
        </section>}
        <WebinarRegisterModal webinar={registeringWebinar} onClose={() => setRegisteringWebinar(null)} />

        {/* How It Works Section */}
        <section id="how-it-works" className="how-section">
          <div className="shell">
            <div className="section-heading centered">
              <p className="eyebrow">A CLEARER WAY IN</p>
              <h2>From intention to <em>in progress.</em></h2>
            </div>
            <div className="steps-grid">
              <HowStep number="01" icon={ClipboardCheck} title="Choose your path" copy="Tell us where your real-estate practice is headed and start a single all-access enrollment." />
              <HowStep number="02" icon={FileSignature} title="Sign with confidence" copy="Complete the academy agreement securely online before you move to protected payment." />
              <HowStep number="03" icon={Zap} title="Begin with clarity" copy="Once approved, set up your account and open your personalized learning dashboard." />
            </div>
          </div>
        </section>

        <Testimonials />
        {/* FAQ Section */}
        <section id="faq" className="faq-section shell section">
          <div className="faq-intro">
            <p className="eyebrow">COMMON QUESTIONS</p>
            <h2>Everything you need to<br /><em>get started.</em></h2>
            <p>Still deciding? Our team is here to help you find the right way forward.</p>
            <a href="mailto:hello@treeacademy.ph" className="text-link">Talk to the academy <ArrowRight size={17} /></a>
          </div>
          <div className="faq-list">
            {faq.map(([question, answer], index) => (
              <button className={`faq-item ${openFaq === index ? 'expanded' : ''}`} key={question} onClick={() => setOpenFaq(openFaq === index ? -1 : index)}>
                <span><strong>{question}</strong><p>{answer}</p></span>
                <span className="faq-icon">{openFaq === index ? '−' : '+'}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Newsletter Section */}
        <section className="newsletter-section">
          <div className="newsletter shell">
            <div className="newsletter-copy"><span className="newsletter-icon"><Mail size={20} /></span><p className="eyebrow">STAY CONNECTED</p><h2>Get insights that move your<br /><em>career forward.</em></h2><p>Receive updates on new review programs, masterclasses, and practical real estate learning resources.</p></div>
            <NewsletterForm />
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
