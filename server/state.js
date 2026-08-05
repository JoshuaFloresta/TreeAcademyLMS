// The two pieces of mutable state read by helper functions that don't have `req` in scope
// (findEnrollment, getPricingSettings, provisionLearnerAccount, etc.), so they can't live on
// req.app.locals — every route/helper module imports this directly instead.

// Flipped once, in boot() (see index.js), after a successful MongoDB connection. Routes and
// helpers read `dbState.ready` to decide whether to hit Mongo or fall back to the in-memory Maps
// below — see the "Database: dual mode" section in CLAUDE.md.
export const dbState = { ready: false }

// Development-only in-memory fallback used when MONGODB_URI is not set. Data is lost on restart.
export const memory = { enrollments: new Map(), newsletter: new Map(), presence: new Map(), users: new Map() }
