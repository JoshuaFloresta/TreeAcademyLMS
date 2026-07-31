import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

// `loading` swaps the trailing arrow for a spinner and disables the button — a visible cue that a
// submit is in flight, on top of whatever pending-state text the caller already shows as children.
export default function PrimaryButton({ children, to, className = '', loading = false, disabled, ...props }) {
  const icon = loading ? <span className="spinner spinner-sm button-spinner" /> : <ArrowRight size={17} />
  if (to) return <Link to={to} className={`button button-primary ${className}`} {...props}>{children}{icon}</Link>
  return <button className={`button button-primary ${className}`} disabled={disabled || loading} {...props}>{children}{icon}</button>
}
