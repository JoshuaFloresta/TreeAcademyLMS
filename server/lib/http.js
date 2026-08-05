import crypto from 'node:crypto'

// Wraps an async Express handler so a rejected promise reaches the error-handling middleware
// instead of crashing the process.
export const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

// Marks an error as safe to show the caller — see the error handler at the bottom of index.js.
export const httpError = (status, message) => Object.assign(new Error(message), { status, expose: true })

export const requireDb = (res, feature) => { res.status(503).json({ error: `${feature} requires MongoDB.` }); return false }

// Private files (signed agreements, certificates, submission attachments) are never public URLs —
// they're fetched from storage and streamed through the route that just authorized the caller.
// The quoted filename keeps browsers from interpreting a name containing spaces or commas.
export function sendPrivateDownload(res, bytes, filename, contentType = 'application/octet-stream') {
  res.type(contentType)
  res.set('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`)
  res.set('Cache-Control', 'private, no-store')
  res.send(bytes)
}

export const id = () => crypto.randomUUID()
