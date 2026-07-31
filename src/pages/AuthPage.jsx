import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { ArrowRight, Clock3 } from 'lucide-react'
import Brand from '../components/Brand.jsx'
import FormField from '../components/FormField.jsx'
import PasswordInput from '../components/PasswordInput.jsx'
import PrimaryButton from '../components/PrimaryButton.jsx'
import StatusPill from '../components/StatusPill.jsx'
import { activate, login as loginRequest, requestPasswordReset } from '../lib/auth.js'

// Accounts are provisioned by academy staff after enrollment approval (a setup link is emailed) —
// there is no self-service signup or Google sign-in. This page handles both returning sign-in and,
// via ?mode=activate&token=..., a first-time learner choosing their own password.
export default function AuthPage({ onAuthenticated }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const isPending = params.get('state') === 'pending'
  const activationToken = params.get('mode') === 'activate' ? params.get('token') : null
  // True right after submitActivation redirects here — the learner lands on plain sign-in rather
  // than being carried straight into the dashboard, so they can confirm the password they just
  // chose actually works. Read fresh from the URL every render (not stored state) since navigating
  // here from the activation form re-renders this same component instance rather than remounting it.
  const isActivated = params.get('state') === 'activated'
  const [notice, setNotice] = useState('')
  const [loginError, setLoginError] = useState('')
  const [activationError, setActivationError] = useState('')
  const [loginPending, setLoginPending] = useState(false)
  const [activationPending, setActivationPending] = useState(false)
  const [resetPending, setResetPending] = useState(false)
  const form = useForm({ defaultValues: { email: '', password: '' } })
  const activationForm = useForm({ defaultValues: { password: '', confirmPassword: '' } })

  const login = async (values) => {
    setLoginError('')
    setLoginPending(true)
    try {
      const user = await loginRequest(values.email, values.password)
      onAuthenticated(user)
      navigate('/dashboard')
    } catch (error) {
      setLoginError(error.message || 'We could not complete that request. Please try again.')
      setLoginPending(false)
    }
  }

  // Reuses the email already typed into the sign-in form rather than opening a separate screen —
  // the response is deliberately identical for unknown addresses, so the notice stays neutral.
  const sendReset = async () => {
    const email = form.getValues('email').trim()
    setLoginError('')
    if (!email) { setNotice('Enter your email address above first, then choose "Forgot password?".'); return }
    setResetPending(true)
    try {
      await requestPasswordReset(email)
      setNotice(`If an account exists for ${email}, a password-reset link is on its way. The link is valid for 72 hours.`)
    } catch (error) {
      setNotice(error.message || 'We could not send that reset link. Please try again.')
    } finally { setResetPending(false) }
  }

  const submitActivation = async (values) => {
    setActivationError('')
    if (values.password !== values.confirmPassword) { setActivationError('Passwords do not match.'); return }
    setActivationPending(true)
    try {
      await activate(activationToken, values.password)
      navigate('/auth?state=activated')
    } catch (error) {
      setActivationError(error.message || 'This account-setup link is invalid or expired.')
      setActivationPending(false)
    }
  }

  const activationContent = <><p className="eyebrow">SET UP YOUR ACCOUNT</p><h2>Choose your<br /><em>password.</em></h2><p className="auth-intro">Set a password to finish activating your Tree Academy account.</p><form onSubmit={activationForm.handleSubmit(submitActivation)} className="auth-form"><FormField label="New password"><PasswordInput placeholder="At least 10 characters" {...activationForm.register('password', { required: true, minLength: 10 })} /></FormField><FormField label="Confirm password"><PasswordInput placeholder="Re-enter your password" {...activationForm.register('confirmPassword', { required: true })} /></FormField>{activationError && <p className="auth-error" role="alert">{activationError}</p>}<PrimaryButton type="submit" loading={activationPending}>{activationPending ? 'Creating password…' : 'Create new password'}</PrimaryButton></form></>

  const pendingContent = <div className="pending-state"><span className="big-status"><Clock3 /></span><p className="eyebrow">ENROLLMENT RECEIVED</p><h2>We’re reviewing your<br /><em>enrollment.</em></h2><p>Once the academy confirms your signed agreement and payment, we’ll send your account-setup link by email.</p><Link to="/" className="button button-primary">Return home <ArrowRight size={17} /></Link></div>

  const loginContent = <><p className="eyebrow">WELCOME BACK</p><h2>Sign in to your<br /><em>learning space.</em></h2><p className="auth-intro">Use the email connected to your approved Tree Academy enrollment.</p>{isActivated && <p className="auth-notice">Your password has been set. Sign in below to continue.</p>}<form onSubmit={form.handleSubmit(login)} className="auth-form"><FormField label="Email address"><input type="email" placeholder="you@email.com" {...form.register('email', { required: true })} /></FormField><FormField label="Password"><PasswordInput placeholder="••••••••" {...form.register('password', { required: true })} /></FormField>{loginError && <p className="auth-error" role="alert">{loginError}</p>}<button type="button" className="forgot" onClick={sendReset} disabled={resetPending}>{resetPending ? 'Sending reset link…' : 'Forgot password?'}</button><PrimaryButton type="submit" loading={loginPending}>{loginPending ? 'Signing in…' : 'Sign in'}</PrimaryButton></form><p className="signup-note">New to Tree Academy? <Link to="/enroll">Begin enrollment</Link></p>{notice && <p className="auth-notice">{notice}</p>}</>

  return <div className="auth-page"><div className="auth-art"><Brand light /><div className="auth-art-content"><StatusPill kind="gold">Your learning space</StatusPill><h1>A more confident<br /><em>way forward.</em></h1><p>One focused place for your course work, instructors, and professional momentum.</p><div className="auth-quote">“The structure made it easier to stay consistent while still handling my clients.”<span>— Marco T., Tree Academy learner</span></div></div></div><main className="auth-panel"><Link to="/" className="auth-back"><ArrowRight size={16} /> Back to home</Link>{activationToken ? activationContent : isPending ? pendingContent : loginContent}</main></div>
}
