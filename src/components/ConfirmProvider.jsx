import { useCallback, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { ConfirmContext } from '../lib/confirmContext.js'
import Modal from './Modal.jsx'

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null)
  const resolver = useRef(null)

  const confirm = useCallback((options) => new Promise((resolve) => {
    resolver.current = resolve
    setRequest(typeof options === 'string' ? { message: options } : options)
  }), [])

  const settle = (result) => { resolver.current?.(result); resolver.current = null; setRequest(null) }

  return <ConfirmContext.Provider value={confirm}>
    {children}
    <Modal open={Boolean(request)} onClose={() => settle(false)} labelledBy="confirm-dialog-title" className="confirm-modal">
      {request && <>
        <span className={`confirm-icon ${request.danger === false ? '' : 'danger'}`}><AlertTriangle size={22} /></span>
        <h2 id="confirm-dialog-title">{request.title ?? 'Are you sure?'}</h2>
        <p className="enrollment-sent-lead">{request.message}</p>
        <div className="confirm-actions">
          <button type="button" className="button button-ghost" onClick={() => settle(false)}>{request.cancelLabel ?? 'Cancel'}</button>
          <button type="button" className={`button ${request.danger === false ? 'button-primary' : 'button-danger-solid'}`} onClick={() => settle(true)}>{request.confirmLabel ?? 'Confirm'}</button>
        </div>
      </>}
    </Modal>
  </ConfirmContext.Provider>
}
