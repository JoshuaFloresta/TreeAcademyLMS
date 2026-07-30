// Single source of truth for "we're waiting on the server". Every page used to show a bare line of
// text, which reads as a frozen screen — especially against the hosted API, which can take tens of
// seconds to wake from idle. A moving spinner is the difference between "loading" and "broken".
//
// `block` fills an empty panel (replacing the page's placeholder icon); the default is an inline
// note that sits in the flow of a list or card.
export default function Loading({ label = 'Loading…', block = false }) {
  if (block) return <div className="empty-state"><span className="spinner spinner-lg" /><strong>{label}</strong></div>
  return <p className="operations-note"><span className="spinner spinner-sm" /> {label}</p>
}
