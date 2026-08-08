import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import LmsLayout from './components/LmsLayout.jsx'
import AuthPage from './pages/AuthPage.jsx'
import BlogPage from './pages/BlogPage.jsx'
import BlogPostPage from './pages/BlogPostPage.jsx'
import CourseApplicationPage from './pages/CourseApplicationPage.jsx'
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

  return <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/blog" element={<BlogPage />} />
    <Route path="/blog/:slug" element={<BlogPostPage />} />
    <Route path="/enroll" element={<EnrollmentPage />} />
    <Route path="/apply/:slug" element={<CourseApplicationPage />} />
    <Route path="/auth" element={<AuthPage onAuthenticated={setUser} />} />
    <Route path="/*" element={<LmsLayout user={user} authReady={authReady} onSignOut={signOut} onUserUpdate={updateUser} />} />
  </Routes>
}

export default App
