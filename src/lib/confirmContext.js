import { createContext, useContext } from 'react'

export const ConfirmContext = createContext(null)

// Returns an async function: `if (!(await confirm({ message: '...' }))) return`
export function useConfirm() {
  const context = useContext(ConfirmContext)
  if (!context) throw new Error('useConfirm must be used within a ConfirmProvider')
  return context
}
