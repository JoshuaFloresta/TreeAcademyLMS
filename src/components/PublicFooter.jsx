import { Link } from 'react-router-dom'
import Brand from './Brand.jsx'

export default function PublicFooter() {
  return <footer className="public-footer"><div className="shell footer-grid"><Brand light /><div><p>© 2026 Tree Academy</p><p>Built for clearer practice.</p></div><div className="footer-links"><a href="#programs">Programs</a><Link to="/blog">Blog</Link><Link to="/auth">Sign in</Link><a href="mailto:hello@treeacademy.ph">Contact</a></div></div></footer>
}
