import { useEffect, useRef } from 'react'

const IDLE_LIMIT_MS = 30 * 60 * 1000 // 30 minutes of no activity
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart']

// Signs an inactive learner out client-side. The refresh-token cookie is valid for 14 days
// (server/lib/session.js) with no server-side idle concept, so without this a signed-in tab left
// open indefinitely (or a shared/public computer) never logs out on its own.
export function useIdleLogout(user, onIdle) {
  const timerRef = useRef(null)

  useEffect(() => {
    if (!user) return undefined
    const reset = () => {
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(onIdle, IDLE_LIMIT_MS)
    }
    reset()
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, reset, { passive: true }))
    return () => {
      clearTimeout(timerRef.current)
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, reset))
    }
  }, [user, onIdle])
}
