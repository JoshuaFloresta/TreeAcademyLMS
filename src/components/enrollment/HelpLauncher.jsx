import { useEffect, useMemo, useRef, useState } from 'react'
import { LifeBuoy, Mail, Minus, Plus, Search, X } from 'lucide-react'
import { searchTopics, supportEmail, topicForError } from '../../lib/enrollmentHelp.js'

function TopicRow({ topic, open, onToggle }) {
  return <div className={open ? 'help-topic expanded' : 'help-topic'}>
    <button type="button" className="help-topic-head" onClick={onToggle} aria-expanded={open}><span>{topic.question}</span><i aria-hidden="true">{open ? <Minus size={11} /> : <Plus size={11} />}</i></button>
    <div className="help-topic-answer"><p>{topic.answer}</p></div>
  </div>
}

// Floating self-serve help. Two things make it more than a static FAQ: topics for the step the
// applicant is actually on sort to the top, and when the page is showing an error we recognize, the
// launcher relabels itself and opens straight to the explanation — which is the moment someone is
// most likely to give up and close the tab.
//
// The panel is a compact popover anchored above the button, not a modal: it never dims or blocks the
// page, so an applicant can read an answer and keep working with the form still visible behind it.
export default function HelpLauncher({ step = null, error = '' }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState('')
  const closeRef = useRef(null)
  const explained = topicForError(error)
  const { onThisStep, other } = useMemo(() => searchTopics(query, step), [query, step])
  const empty = !onThisStep.length && !other.length

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const openPanel = () => { setQuery(''); setExpanded(explained?.id ?? ''); setOpen(true) }
  const toggle = (id) => setExpanded((current) => (current === id ? '' : id))
  const group = (title, topics) => topics.length
    ? <div className="help-group"><p className="help-group-title">{title}</p>{topics.map((topic) => <TopicRow key={topic.id} topic={topic} open={expanded === topic.id} onToggle={() => toggle(topic.id)} />)}</div>
    : null

  return <>
    <button type="button" className={explained ? 'help-launcher flagged' : 'help-launcher'} onClick={openPanel} aria-haspopup="dialog" aria-expanded={open}><LifeBuoy size={18} /><span>{explained ? 'Why did this fail?' : 'Need help?'}</span></button>
    {open && <>
      <div className="help-dismiss" onClick={() => setOpen(false)} aria-hidden="true" />
      <div className="help-panel" role="dialog" aria-labelledby="help-panel-title">
        <div className="help-panel-head">
          <div><p className="eyebrow">ENROLLMENT HELP</p><h2 id="help-panel-title">Getting stuck?</h2></div>
          <button type="button" ref={closeRef} className="help-panel-close" onClick={() => setOpen(false)} aria-label="Close help"><X size={16} /></button>
        </div>
        <label className="help-search"><Search size={14} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search, e.g. “signature”" aria-label="Search help topics" /></label>
        <div className="help-scroll">
          {group(query ? 'Best matches' : step == null ? 'Common questions' : 'On this step', onThisStep)}
          {group(query ? 'Other matches' : 'Other questions', other)}
          {empty && <p className="help-empty">Nothing matches “{query}”. Try a single word, or email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p>}
        </div>
        <a className="help-panel-foot" href={`mailto:${supportEmail}?subject=${encodeURIComponent('Help with my Tree Academy enrollment')}`}><Mail size={15} /><span><strong>Still stuck? Email us.</strong><small>Tell us what you were doing and we’ll reply.</small></span></a>
      </div>
    </>}
  </>
}
