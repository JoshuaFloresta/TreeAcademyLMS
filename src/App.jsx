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
import { checkAuthSession, getCurrentUser, hasSessionHint, logout, subscribeAuth } from './lib/auth.js'
import { useIdleLogout } from './lib/useIdleLogout.js'
import { useToast } from './lib/toastContext.js'
import './App.css'

function App() {
  const [user, setUser] = useState(getCurrentUser)
  const [authReady, setAuthReady] = useState(false)
  const [authStatus, setAuthStatus] = useState(() => (hasSessionHint() ? 'loading' : 'unauthenticated'))
  const [authError, setAuthError] = useState(null)
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()

  // Subscribe to auth state updates (session expired, login, logout)
  useEffect(() => {
    return subscribeAuth((nextUser, reason) => {
      setUser(nextUser)
      if (nextUser) {
        setAuthStatus('authenticated')
        setAuthError(null)
      } else {
        setAuthStatus('unauthenticated')
        if (reason === 'expired') {
          const currentPath = location.pathname + location.search
          const publicPaths = ['/', '/about', '/blog', '/enroll', '/auth']
          const isPublic = publicPaths.includes(location.pathname) || location.pathname.startsWith('/blog/') || location.pathname.startsWith('/apply/')
          if (!isPublic) {
            navigate(`/auth?redirect=${encodeURIComponent(currentPath)}&reason=expired`, { replace: true })
            toast.error('Your session has expired. Please sign in again.')
          }
        }
      }
    })
  }, [location.pathname, location.search, navigate, toast])

  const retryAuth = useCallback(async () => {
    setAuthStatus('loading')
    setAuthError(null)
    try {
      const result = await checkAuthSession()
      setUser(result.user)
      setAuthStatus(result.status)
      setAuthError(result.error || null)
    } catch (err) {
      console.warn('Session verification failed:', err)
      setUser(null)
      setAuthStatus('error')
      setAuthError('Unable to connect to the server.')
    } finally {
      setAuthReady(true)
    }
  }, [])

  // Restore the session on mount. If no session hint exists, checkAuthSession resolves
  // instantly (0ms) so logged-out users are never delayed by network round-trips.
  useEffect(() => {
    let cancelled = false

    // App-level watchdog: guarantees auth check resolves within 4500ms max,
    // completely preventing any infinite spinner or loading hang.
    const watchdog = setTimeout(() => {
      if (!cancelled) {
        setAuthReady((ready) => {
          if (!ready) {
            console.warn('Auth check watchdog reached timeout, releasing loading state.')
            setAuthStatus((current) => (current === 'loading' ? 'error' : current))
            setAuthError('Connection timed out. Server may be starting up.')
            return true
          }
          return ready
        })
      }
    }, 4500)

    checkAuthSession()
      .then((result) => {
        if (!cancelled) {
          setUser(result.user)
          setAuthStatus(result.status)
          setAuthError(result.error || null)
        }
      })
      .catch((err) => {
        console.warn('Session verification failed:', err)
        if (!cancelled) {
          setUser(null)
          setAuthStatus('error')
          setAuthError('Unable to connect to the server.')
        }
      })
      .finally(() => {
        clearTimeout(watchdog)
        if (!cancelled) {
          setAuthReady(true)
        }
      })

    return () => {
      cancelled = true
      clearTimeout(watchdog)
    }
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
    <Route path="/*" element={<LmsLayout user={user} authReady={authReady} authStatus={authStatus} authError={authError} onRetryAuth={retryAuth} onSignOut={signOut} onUserUpdate={updateUser} />} />
  </Routes>
}

export default App
