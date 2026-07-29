import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Link as LinkIcon, Quote, Undo, Redo } from 'lucide-react'

const EMPTY_HTML = new Set(['', '<p></p>'])

function ToolbarButton({ active, disabled, onClick, label, children }) {
  return <button type="button" className={`rich-text-tool ${active ? 'active' : ''}`} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick} aria-label={label} title={label}>
    {children}
  </button>
}

// Rich text authoring surface for instructor content (lesson bodies, assignment instructions,
// quiz prompts/explanations). Stores HTML; pair with RichTextViewer to render it safely.
export default function RichTextEditor({ value, onChange, placeholder, ariaLabel }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [3, 4] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: placeholder || 'Start typing…' }),
    ],
    content: value || '',
    onUpdate: ({ editor: instance }) => {
      const html = instance.getHTML()
      onChange(EMPTY_HTML.has(html) ? '' : html)
    },
    editorProps: { attributes: { 'aria-label': ariaLabel || 'Rich text content', class: 'rich-text-content' } },
  }, [])

  if (!editor) return null

  const setLink = () => {
    const previous = editor.getAttributes('link').href
    const url = window.prompt('Link URL', previous || 'https://')
    if (url === null) return
    if (!url.trim()) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
  }

  return <div className="rich-text-editor">
    <div className="rich-text-toolbar">
      <ToolbarButton label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={14} /></ToolbarButton>
      <ToolbarButton label="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={14} /></ToolbarButton>
      <ToolbarButton label="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon size={14} /></ToolbarButton>
      <span className="rich-text-tool-divider" />
      <ToolbarButton label="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={14} /></ToolbarButton>
      <ToolbarButton label="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={14} /></ToolbarButton>
      <ToolbarButton label="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={14} /></ToolbarButton>
      <ToolbarButton label="Link" active={editor.isActive('link')} onClick={setLink}><LinkIcon size={14} /></ToolbarButton>
      <span className="rich-text-tool-divider" />
      <ToolbarButton label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo size={14} /></ToolbarButton>
      <ToolbarButton label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo size={14} /></ToolbarButton>
    </div>
    <EditorContent editor={editor} />
  </div>
}
