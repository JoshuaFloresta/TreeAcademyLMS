import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import Brand from './Brand.jsx'
import PrimaryButton from './PrimaryButton.jsx'

export default function PublicHeader() {
  const [open, setOpen] = useState(false)

  return <header className="public-header">
    <div className="public-nav shell">
      <Brand />
      <button className="mobile-menu" onClick={() => setOpen(!open)} aria-label="Toggle menu">{open ? <X /> : <Menu />}</button>
      <nav className={open ? 'open' : ''}>
        <a href="#programs" onClick={() => setOpen(false)}>Programs</a>
        <a href="#how-it-works" onClick={() => setOpen(false)}>How it works</a>
        <a href="#faq" onClick={() => setOpen(false)}>FAQ</a>
        <Link to="/blog" onClick={() => setOpen(false)}>Blog</Link>
        <Link to="/auth" onClick={() => setOpen(false)}>Sign in</Link>
        <PrimaryButton to="/enroll" className="nav-cta" onClick={() => setOpen(false)}>Get all-access</PrimaryButton>
      </nav>
    </div>
  </header>
}
