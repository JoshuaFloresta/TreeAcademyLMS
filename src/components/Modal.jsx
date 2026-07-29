import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export default function Modal({ open, onClose, labelledBy, className = '', children }) {
  const closeRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    closeRef.current?.focus()
    const onKey = (event) => { if (event.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])

  if (!open) return null

  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={labelledBy} onClick={onClose}>
    <div className={`modal-panel ${className}`} onClick={(event) => event.stopPropagation()}>
      <button type="button" ref={closeRef} className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
      {children}
    </div>
  </div>
}
