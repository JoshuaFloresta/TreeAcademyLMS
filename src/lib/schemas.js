import { z } from 'zod'

export const newsletterSchema = z.object({ email: z.string().email('Enter a valid email address.') })
export const enrollmentSchema = z.object({
  name: z.string().min(2, 'Please enter your full name.'),
  email: z.string().email('Please enter a valid email address.'),
  phone: z.string().min(7, 'Please enter a contact number.'),
})
