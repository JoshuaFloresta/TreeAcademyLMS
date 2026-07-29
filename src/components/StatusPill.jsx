export default function StatusPill({ children, kind = 'green' }) {
  return <span className={`status-pill ${kind}`}>{children}</span>
}
