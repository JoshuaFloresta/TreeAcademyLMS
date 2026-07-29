import DOMPurify from 'dompurify'

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'h3', 'h4', 'code', 'pre']

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer') }
})

// Renders instructor-authored HTML (lesson bodies, assignment instructions, quiz prompts/
// explanations) produced by RichTextEditor. Always sanitize on render — content passes through
// the API and back, so this is the last line of defense against a compromised staff account.
export default function RichTextViewer({ html, className }) {
  if (!html) return null
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR: ['href', 'target', 'rel'] })
  return <div className={`rich-text-viewer ${className || ''}`} dangerouslySetInnerHTML={{ __html: clean }} />
}
