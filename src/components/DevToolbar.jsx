import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Code2, X } from 'lucide-react'
import { getDevPagesForRole } from '../lib/lmsPages.js'
import { pathways } from '../lib/academyData.js'
import { createDevEnrollmentAt } from '../lib/devEnrollment.js'

// Development-only page navigator: jumps directly to any LMS route without clicking through
// the app, and can fast-forward a fresh enrollment straight to contract signing or payment.
// The current role/view options reflect whoever is actually signed in — this panel no longer
// fakes a role switch, since real seeded accounts (npm run seed:dummy) cover that now.
export default function DevToolbar({ role }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [pathwayId, setPathwayId] = useState(pathways[0].id)
  const [jumping, setJumping] = useState(false)
  const views = getDevPagesForRole(role)
  const currentView = views.some((view) => view.to === location.pathname) ? location.pathname : ''

  const jumpTo = async (targetStep) => {
    setJumping(true)
    try {
      const bootstrap = await createDevEnrollmentAt(targetStep, pathwayId)
      sessionStorage.setItem('treeacademy_dev_bootstrap', JSON.stringify(bootstrap))
      navigate(`/enroll?pathway=${pathwayId}`)
      setOpen(false)
    } catch (error) {
      window.alert(error.message)
    } finally {
      setJumping(false)
    }
  }

  return <aside className={`dev-toolbar ${open ? 'open' : ''}`} aria-label="Development page navigator">
    <button className="dev-toolbar-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
      <Code2 size={18} />
      <span>Dev pages</span>
    </button>
    {open && <div className="dev-toolbar-panel">
      <div className="dev-toolbar-head">
        <div><p>DEVELOPMENT ONLY</p><h3>Page navigator</h3></div>
        <button onClick={() => setOpen(false)} aria-label="Close developer toolbar"><X size={17} /></button>
      </div>
      <div className="dev-section dev-view-section">
        <label className="dev-label" htmlFor="dev-page-view">{role.charAt(0).toUpperCase() + role.slice(1)} views</label>
        <select id="dev-page-view" className="dev-view-select" value={currentView} onChange={(event) => event.target.value && navigate(event.target.value)}>
          <option value="" disabled>Select a page</option>
          {views.map((view) => <option key={view.to} value={view.to}>{view.label}</option>)}
        </select>
        <small className="dev-page-count">{views.length} available page{views.length === 1 ? '' : 's'}</small>
      </div>
      <div className="dev-section dev-enrollment-section">
        <label className="dev-label" htmlFor="dev-pathway">Enrollment shortcuts</label>
        <select id="dev-pathway" className="dev-view-select" value={pathwayId} onChange={(event) => setPathwayId(event.target.value)}>
          {pathways.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <div className="dev-shortcut-row">
          <button type="button" onClick={() => jumpTo(2)} disabled={jumping}>Jump to contract signing</button>
          <button type="button" onClick={() => jumpTo(3)} disabled={jumping}>Jump to payment</button>
        </div>
      </div>
    </div>}
  </aside>
}
