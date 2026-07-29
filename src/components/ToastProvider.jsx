import { useCallback, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { ToastContext } from '../lib/toastContext.js'

const icons = { success: CheckCircle2, error: AlertTriangle, info: Info }

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(0)

  const dismiss = useCallback((id) => setToasts((current) => current.filter((toast) => toast.id !== id)), [])

  const show = useCallback((message, options = {}) => {
    const id = nextId.current++
    const kind = options.kind ?? 'success'
    setToasts((current) => [...current, { id, message, kind }])
    window.setTimeout(() => dismiss(id), options.duration ?? 4500)
    return id
  }, [dismiss])

  const api = useMemo(() => ({
    show,
    success: (message, options) => show(message, { ...options, kind: 'success' }),
    error: (message, options) => show(message, { ...options, kind: 'error' }),
    info: (message, options) => show(message, { ...options, kind: 'info' }),
  }), [show])

  return <ToastContext.Provider value={api}>
    {children}
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((item) => {
        const Icon = icons[item.kind] ?? Info
        return <div className={`toast toast-${item.kind}`} key={item.id}>
          <Icon size={16} />
          <span>{item.message}</span>
          <button type="button" onClick={() => dismiss(item.id)} aria-label="Dismiss"><X size={13} /></button>
        </div>
      })}
    </div>
  </ToastContext.Provider>
}
