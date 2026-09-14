import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import PublicHeader from '../components/PublicHeader.jsx'
import PublicFooter from '../components/PublicFooter.jsx'

const sections = [
  { id: 'history', label: 'History' },
  { id: 'ra9646', label: 'RA 9646' },
  { id: 'bsrem', label: 'Transition to BSREM' },
  { id: 'regulatory-gap', label: 'Regulatory gap' },
  { id: 'why', label: 'Why Pass-First' },
  { id: 'philosophy', label: 'Philosophy' },
  { id: 'programs', label: 'Programs' },
]

export default function AboutPage() {
  return (
    <div className="public-page">
      <PublicHeader />
      <main>
        <section className="about-hero shell section">
          <p className="eyebrow">OUR STORY</p>
          <h1>The History and Birth of<br /><em>Pass-First Review</em></h1>
        </section>

        <div className="about-layout shell">
          {/* Sticky sidebar nav */}
          <aside className="about-sidebar">
            <nav>
              {sections.map((s) => (
                <a key={s.id} href={`#${s.id}`} className="about-sidebar-link">{s.label}</a>
              ))}
              <Link to="/" className="about-sidebar-link about-sidebar-back"><ArrowLeft size={13} /> Home</Link>
            </nav>
          </aside>

          {/* Main long-form content */}
          <article className="about-article">

            <section id="history" className="about-section">
              <h2>Before the Bachelor's Degree</h2>
              <p>
                Before the Bachelor of Science in Real Estate Management became the principal academic pathway to the real-estate licensure examinations, aspiring practitioners followed a very different route.
              </p>
              <p>
                Real-estate education was delivered largely through comprehensive seminars, formal training programs and examination reviews. One of the best-known programs was the Comprehensive Real Estate Seminar and Review, commonly called <strong>CRESAR</strong>. Candidates were required to complete prescribed real-estate subjects and satisfy the educational and experience requirements imposed by the regulatory authority.
              </p>
              <p>
                During this period, real-estate education was not simply a collection of informal lectures. Training providers, programs and instructors operated within a professional regulatory environment. The seminar was connected not only with examination preparation but, during the applicable period, with establishing that a candidate had completed the required real-estate education or training.
              </p>
            </section>

            <section id="ra9646" className="about-section">
              <h2>The Enactment of the Real Estate Service Act</h2>
              <p>
                In 2009, Republic Act No. 9646, known as the <strong>Real Estate Service Act of the Philippines</strong>, transformed the regulation of the profession.
              </p>
              <p>
                Regulatory responsibility was placed under the Professional Regulation Commission and the Professional Regulatory Board of Real Estate Service. The law formally recognized and regulated Real Estate Brokers, Real Estate Appraisers, Real Estate Consultants, Real Estate Assessors and accredited Real Estate Salespersons.
              </p>
              <p>
                RA 9646 also established a new educational direction. It provided that once the Commission on Higher Education implemented a bachelor's degree in real estate service, that degree would become the educational requirement for admission to the corresponding licensure examinations.
              </p>
              <p>
                This resulted in the development and eventual implementation of the Bachelor of Science in Real Estate Management.
              </p>
            </section>

            <section id="bsrem" className="about-section">
              <h2>The Transition to BSREM</h2>
              <p>
                The transition did not happen overnight. For a period, candidates with relevant bachelor's degrees, prescribed real-estate subjects, professional experience and recognized training could still qualify under the applicable transitional rules.
              </p>
              <p>
                Eventually, BSREM became the principal academic route for new Real Estate Broker and Real Estate Appraiser examinees. Real Estate Consultancy retained additional professional-experience requirements because consultancy represents the highest analytical and advisory level of real-estate service.
              </p>
              <p>
                The transition strengthened formal real-estate education. However, it also changed the role of the traditional review center. The college or university became responsible for awarding the degree and providing the formal academic foundation. The review center became responsible for helping qualified graduates retrieve, integrate and apply that knowledge under licensure-examination conditions.
              </p>
            </section>

            <section id="regulatory-gap" className="about-section">
              <h2>The Regulatory Gap in Independent Review Education</h2>
              <p>
                The government previously attempted to place all independent review centers under CHED through Executive Order No. 566 and CHED Memorandum Order No. 30, series of 2007.
              </p>
              <p>
                In 2009, the Supreme Court declared these issuances unconstitutional. The Court held that CHED's statutory jurisdiction covered higher-education institutions and degree-granting programs — not independent, non-degree review centers.
              </p>
              <p>
                The decision protected the right of independent review centers to operate. But it also created a practical challenge: without a dedicated nationwide quality-control system for independent review providers, the quality, completeness and accountability of review programs could vary considerably.
              </p>
              <p>
                Some programs offered excellent preparation. Others depended primarily on lectures, recycled materials or memorization. Examinees could attend an entire review program and still discover during the licensure examination that important subjects had not been adequately covered.
              </p>
            </section>

            <section id="why" className="about-section">
              <h2>Why I Created Pass-First Review</h2>
              <p>
                I experienced the consequences of incomplete preparation personally.
              </p>
              <p>
                When I took professional licensure examinations, I learned that passing was not determined merely by attendance, intelligence or memorization. An examinee needed complete materials, updated laws, properly organized subjects, realistic simulations and mentors who understood how professional knowledge was tested.
              </p>
              <p>
                My 2019 Environmental Planner Licensure Examination experience made this lesson even clearer. Government procurement was part of the examination, but I did not have sufficient materials for that subject. That single gap demonstrated how an otherwise prepared candidate could be placed at a serious disadvantage because one important area had been overlooked.
              </p>
              <p>
                That experience stayed with me. It became one of the reasons I gave birth to <strong>Pass-First Review</strong>.
              </p>
            </section>

            <section id="philosophy" className="about-section">
              <h2>The Pass-First Philosophy</h2>
              <p>
                Pass-First was established to restore structure, completeness and accountability to licensure-examination preparation.
              </p>
              <p>
                Its purpose is not to replace the university, the law, PRC or the candidate's professional responsibility. Its purpose is to bridge the distance between academic knowledge and examination performance.
              </p>
              <p>Pass-First therefore stands on the following commitments:</p>
              <ul className="about-commitments">
                <li>Complete and properly mapped subject coverage</li>
                <li>Updated laws, standards and professional practices</li>
                <li>Qualified practitioner-mentors</li>
                <li>Original and organized learning materials</li>
                <li>Situational and analytical examination questions</li>
                <li>Identification of individual competency gaps</li>
                <li>Assessment, mentoring and recalibration</li>
                <li>Realistic mock examinations</li>
                <li>Ethical preparation without leaked or confidential questions</li>
                <li>Continuous improvement based on examination experience and changes in professional practice</li>
              </ul>
              <p>
                Under the TREE Academy system, review preparation is not treated as passive review. It is a progressive professional-development process.
              </p>
              <p>
                The candidate must first demonstrate stock knowledge. Weaknesses are then identified. Mentoring follows only after the candidate has attempted to analyze the problem. The candidate is subsequently reassessed until the required competency is demonstrated.
              </p>
            </section>

            <section id="programs" className="about-section">
              <h2>From Review Center to Professional Preparation System</h2>
              <p>
                Pass-First began as a response to the weaknesses William L. Floresta observed and personally experienced in traditional review education.
              </p>
              <p>It has since developed into an integrated preparation system for:</p>
              <ul className="about-programs-list">
                <li><strong>REBLEX</strong> — Real Estate Brokers Licensure Examination</li>
                <li><strong>REALEX</strong> — Real Estate Appraisers Licensure Examination</li>
                <li><strong>RECLEX</strong> — Real Estate Consultants Licensure Examination</li>
                <li><strong>EnPLE Review</strong> — Environmental Planners Licensure Examination <em>(coming soon)</em></li>
              </ul>
              <p>
                Each program respects the official qualifications and examination requirements of the respective profession. Pass-First does not confer eligibility, issue a professional license or replace a degree required by law.
              </p>

              <blockquote className="about-quote">
                <p>What it provides is the preparation that every qualified examinee deserves:</p>
                <p><strong>Structured learning. Complete coverage. Accountable mentoring. Professional judgment.</strong></p>
              </blockquote>

              <p>
                Pass-First was born from a simple conviction:
              </p>
              <p className="about-conviction">
                No serious candidate should enter a licensure examination only to discover that an important subject was never properly taught.
              </p>
              <p>
                We do not merely teach candidates to memorize possible answers. We prepare them to analyze facts, apply the law, exercise professional judgment and choose the most defensible answer.
              </p>
              <p className="about-tagline">
                That is the history of Pass-First Review.<br />
                <em>Born from experience. Built on professional responsibility. Committed to helping every examinee take charge.</em>
              </p>
            </section>

          </article>
        </div>
      </main>
      <PublicFooter />
    </div>
  )
}
