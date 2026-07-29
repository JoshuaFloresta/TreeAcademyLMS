import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

export default function PrimaryButton({ children, to, className = '', ...props }) {
  if (to) return <Link to={to} className={`button button-primary ${className}`} {...props}>{children}<ArrowRight size={17} /></Link>
  return <button className={`button button-primary ${className}`} {...props}>{children}<ArrowRight size={17} /></button>
}
