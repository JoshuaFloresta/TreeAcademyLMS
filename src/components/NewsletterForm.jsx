import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowRight } from 'lucide-react'
import { API_URL } from '../lib/api.js'
import { newsletterSchema } from '../lib/schemas.js'

export default function NewsletterForm() {
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset
  } = useForm({
    resolver: zodResolver(newsletterSchema),
    mode: 'onSubmit'
  })

  const submit = async (values) => {
    setMessage('')
    setIsError(false)

    try {
      const response = await fetch(`${API_URL}/api/newsletter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: values.email })
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) throw new Error(data.error || 'Unable to join the newsletter.')

      reset()
      setSubmitted(true)
    } catch (error) {
      console.error('Submission error:', error)
      setIsError(true)
      setMessage('Something went wrong. Please try again later.')
    }
  }

  if (submitted) {
    return <div className="newsletter-success" role="status" aria-live="polite">You’re on the list. Please check your inbox.</div>
  }

  const messageClass = `form-message ${errors.email || isError ? 'error' : ''}`

  return (
    <form className="newsletter-form" onSubmit={handleSubmit(submit)} noValidate>
      <label className="sr-only" htmlFor="newsletter-email">Email address</label>
      <input
        id="newsletter-email"
        type="email"
        placeholder="Your email address"
        {...register('email')}
        aria-invalid={Boolean(errors.email)}
      />
      <button type="submit" className="button button-gold" disabled={isSubmitting}>
        {isSubmitting ? 'Joining…' : 'Join the list'} <ArrowRight size={17} />
      </button>
      <p className={messageClass}>
        {errors.email?.message || message || 'One thoughtful email a month. Unsubscribe anytime.'}
      </p>
    </form>
  )
}
