import { useCallback, useEffect, useState } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import LmsLayout from './components/LmsLayout.jsx'
import AboutPage from './pages/AboutPage.jsx'
import AuthPage from './pages/AuthPage.jsx'
import BlogPage from './pages/BlogPage.jsx'
import BlogPostPage from './pages/BlogPostPage.jsx'
import CourseApplicationPage from './pages/CourseApplicationPage.jsx'
import EnrollmentPage from './pages/EnrollmentPage.jsx'
import LandingPage from './pages/LandingPage.jsx'
import { getCurrentUser, logout, refreshSession, subscribeAuth } from './lib/auth.js'
import { useIdleLogout } from './lib/useIdleLogout.js'
import { useToast } from './lib/toastContext.js'
import './App.css'

function App() {
  const [user, setUser] = useState(getCurrentUser)
  const [authReady, setAuthReady] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()

  // Subscribe to auth state updates (session expired, login, logout)
  useEffect(() => {
    return subscribeAuth((nextUser, reason) => {
      setUser(nextUser)
      if (!nextUser && reason === 'expired') {
        const currentPath = location.pathname + location.search
        const publicPaths = ['/', '/about', '/blog', '/enroll', '/auth']
        const isPublic = publicPaths.includes(location.pathname) || location.pathname.startsWith('/blog/') || location.pathname.startsWith('/apply/')
        if (!isPublic) {
          navigate(`/auth?redirect=${encodeURIComponent(currentPath)}&reason=expired`, { replace: true })
          toast.error('Your session has expired. Please sign in again.')
        }
      }
    })
  }, [location.pathname, location.search, navigate, toast])

  // Restore the session from the httpOnly refresh cookie on first load, since the in-memory
  // access token in lib/auth.js does not survive a page refresh.
  useEffect(() => {
    let cancelled = false
    refreshSession()
      .then((restoredUser) => {
        if (!cancelled) setUser(restoredUser)
      })
      .catch((err) => {
        console.warn('Session restoration failed:', err)
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true)
      })
    return () => { cancelled = true }
  }, [])

  const signOut = async () => { await logout(); setUser(null) }
  const updateUser = (patch) => setUser((current) => (current ? { ...current, ...patch } : current))

  const handleIdle = useCallback(async () => {
    await logout()
    setUser(null)
    const currentPath = location.pathname + location.search
    const publicPaths = ['/', '/about', '/blog', '/enroll', '/auth']
    const isPublic = publicPaths.includes(location.pathname) || location.pathname.startsWith('/blog/') || location.pathname.startsWith('/apply/')
    if (!isPublic) {
      navigate(`/auth?redirect=${encodeURIComponent(currentPath)}&reason=logged_out`, { replace: true })
    } else {
      navigate('/auth?reason=logged_out', { replace: true })
    }
    toast.info('You were signed out after 30 minutes of inactivity.')
  }, [location.pathname, location.search, navigate, toast])
  useIdleLogout(user, handleIdle)

  return <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/about" element={<AboutPage />} />
    <Route path="/blog" element={<BlogPage />} />
    <Route path="/blog/:slug" element={<BlogPostPage />} />
    <Route path="/enroll" element={<EnrollmentPage />} />
    <Route path="/apply/:slug" element={<CourseApplicationPage />} />
    <Route path="/auth" element={<AuthPage onAuthenticated={setUser} />} />
    <Route path="/*" element={<LmsLayout user={user} authReady={authReady} onSignOut={signOut} onUserUpdate={updateUser} />} />
  </Routes>
}

export default App
