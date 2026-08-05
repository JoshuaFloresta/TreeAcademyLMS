import { z } from 'zod'

// A cleared input arrives as '' from the browser; every optional field means "unset" by it.
export const blankToNull = (schema) => z.preprocess((value) => (typeof value === 'string' && !value.trim() ? null : value), schema.nullable().optional())

export const usernameField = z.string().trim().toLowerCase().min(3).max(30).regex(/^[a-z0-9._-]+$/, 'Usernames use letters, numbers, dot, underscore, or hyphen.')
