import { Link } from 'react-router-dom'

export default function Brand({ light = false }) {
  return <Link className={`brand ${light ? 'brand-light' : ''}`} to="/" aria-label="Tree Academy home"><span className="brand-mark"><span /></span><span>tree<span>academy</span></span></Link>
}
