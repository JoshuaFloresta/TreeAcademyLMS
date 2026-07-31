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
  const [loginError, setLoginError] = useState('')
  const [activationError, setActivationError] = useState('')
  const [loginPending, setLoginPending] = useState(false)
  const [activationPending, setActivationPending] = useState(false)
  // Password reset is its own step on this page rather than a one-click action on the sign-in form,
  // so the address the link is sent to is always shown and confirmed before anything is emailed.
  const [resetMode, setResetMode] = useState(false)
  const [resetPending, setResetPending] = useState(false)
  const [resetError, setResetError] = useState('')
  const [resetSentTo, setResetSentTo] = useState('')
  const form = useForm({ defaultValues: { email: '', password: '' } })
  const activationForm = useForm({ defaultValues: { password: '', confirmPassword: '' } })
  const resetForm = useForm({ defaultValues: { email: '' } })

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

  // Carries over anything already typed into the sign-in field so the address is pre-filled, but it
  // still has to be seen and submitted on the reset step — nothing is emailed on this click alone.
  const openReset = () => {
    setLoginError(''); setResetError(''); setResetSentTo('')
    resetForm.reset({ email: form.getValues('email').trim() })
    setResetMode(true)
  }

  const closeReset = () => { setResetMode(false); setResetError(''); setResetSentTo('') }

  // The server answers identically whether or not the address is registered, so the confirmation
  // has to stay neutral — it must not become a way to discover which emails have accounts.
  const submitReset = async (values) => {
    const email = values.email.trim()
    setResetError('')
    setResetPending(true)
    try {
      await requestPasswordReset(email)
      setResetSentTo(email)
    } catch (error) {
      setResetError(error.message || 'We could not send that reset link. Please try again.')
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

  const resetContent = resetSentTo
    ? <><p className="eyebrow">CHECK YOUR EMAIL</p><h2>Your reset link<br /><em>is on its way.</em></h2><p className="auth-intro">If an account exists for <strong>{resetSentTo}</strong>, we’ve sent a link for choosing a new password. It stays valid for 72 hours.</p><p className="auth-notice">Nothing arrived? Check your spam folder, or try again with a different address.</p><form className="auth-form" onSubmit={(event) => { event.preventDefault(); closeReset() }}><PrimaryButton type="submit">Back to sign in</PrimaryButton></form><button type="button" className="forgot" onClick={() => { setResetSentTo(''); resetForm.reset({ email: '' }) }}>Use a different email</button></>
    : <><p className="eyebrow">RESET YOUR PASSWORD</p><h2>Forgot your<br /><em>password?</em></h2><p className="auth-intro">Enter the email connected to your Tree Academy account and we’ll send a link for setting a new password.</p><form onSubmit={resetForm.handleSubmit(submitReset)} className="auth-form"><FormField label="Email address"><input type="email" placeholder="you@email.com" autoFocus {...resetForm.register('email', { required: true })} /></FormField>{resetError && <p className="auth-error" role="alert">{resetError}</p>}<PrimaryButton type="submit" loading={resetPending}>{resetPending ? 'Sending reset link…' : 'Send reset link'}</PrimaryButton></form><button type="button" className="forgot" onClick={closeReset}>Back to sign in</button></>

  const pendingContent = <div className="pending-state"><span className="big-status"><Clock3 /></span><p className="eyebrow">ENROLLMENT RECEIVED</p><h2>We’re reviewing your<br /><em>enrollment.</em></h2><p>Once the academy confirms your signed agreement and payment, we’ll send your account-setup link by email.</p><Link to="/" className="button button-primary">Return home <ArrowRight size={17} /></Link></div>

  const loginContent = <><p className="eyebrow">WELCOME BACK</p><h2>Sign in to your<br /><em>learning space.</em></h2><p className="auth-intro">Use the email connected to your approved Tree Academy enrollment.</p>{isActivated && <p className="auth-notice">Your password has been set. Sign in below to continue.</p>}<form onSubmit={form.handleSubmit(login)} className="auth-form"><FormField label="Email address"><input type="email" placeholder="you@email.com" {...form.register('email', { required: true })} /></FormField><FormField label="Password"><PasswordInput placeholder="••••••••" {...form.register('password', { required: true })} /></FormField>{loginError && <p className="auth-error" role="alert">{loginError}</p>}<button type="button" className="forgot" onClick={openReset}>Forgot password?</button><PrimaryButton type="submit" loading={loginPending}>{loginPending ? 'Signing in…' : 'Sign in'}</PrimaryButton></form><p className="signup-note">New to Tree Academy? <Link to="/enroll">Begin enrollment</Link></p></>

  return <div className="auth-page"><div className="auth-art"><Brand light /><div className="auth-art-content"><StatusPill kind="gold">Your learning space</StatusPill><h1>A more confident<br /><em>way forward.</em></h1><p>One focused place for your course work, instructors, and professional momentum.</p><div className="auth-quote">“The structure made it easier to stay consistent while still handling my clients.”<span>— Marco T., Tree Academy learner</span></div></div></div><main className="auth-panel"><Link to="/" className="auth-back"><ArrowRight size={16} /> Back to home</Link>{activationToken ? activationContent : isPending ? pendingContent : resetMode ? resetContent : loginContent}</main></div>
}
