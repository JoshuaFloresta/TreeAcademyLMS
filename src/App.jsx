import { useEffect, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import DevToolbar from './components/DevToolbar.jsx'
import LmsLayout from './components/LmsLayout.jsx'
import AuthPage from './pages/AuthPage.jsx'
import EnrollmentPage from './pages/EnrollmentPage.jsx'
import LandingPage from './pages/LandingPage.jsx'
import { getCurrentUser, logout, refreshSession } from './lib/auth.js'
import './App.css'

function App() {
  const [user, setUser] = useState(getCurrentUser)
  const [authReady, setAuthReady] = useState(false)

  // Restore the session from the httpOnly refresh cookie on first load, since the in-memory
  // access token in lib/auth.js does not survive a page refresh.
  useEffect(() => {
    let cancelled = false
    refreshSession().then((restoredUser) => { if (!cancelled) { setUser(restoredUser); setAuthReady(true) } })
    return () => { cancelled = true }
  }, [])

  const signOut = async () => { await logout(); setUser(null) }
  const updateUser = (patch) => setUser((current) => (current ? { ...current, ...patch } : current))

  return <>
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/enroll" element={<EnrollmentRoute />} />
      <Route path="/auth" element={<AuthPage onAuthenticated={setUser} />} />
      <Route path="/*" element={<LmsLayout user={user} authReady={authReady} onSignOut={signOut} onUserUpdate={updateUser} />} />
    </Routes>
    {import.meta.env.DEV && <DevToolbar role={user?.role ?? 'learner'} />}
  </>
}

// DevToolbar renders globally (including while already on /enroll), and its "jump to contract
// signing / payment" shortcuts stash a fast-forwarded enrollment then navigate here — react-router
// doesn't remount a route element just because the query string changed, so without this key the
// page's useState initializers (which read that stash) would never re-run on a repeat jump. Keying
// by location.key — unique per navigation entry, even to an identical URL — forces a fresh mount
// every time so the shortcut reliably takes effect.
function EnrollmentRoute() {
  const location = useLocation()
  return <EnrollmentPage key={location.key} />
}

export default App
