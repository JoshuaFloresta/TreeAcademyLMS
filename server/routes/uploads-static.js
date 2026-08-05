import path from 'node:path'
import express from 'express'
import { PUBLIC_PREFIX, getFile } from '../storage.js'

export const router = express.Router()

// Serves the public/ prefix of the storage layer. When a public bucket hostname is configured the
// browser goes straight to the CDN and never hits this route, but it stays mounted so avatars and
// banners still resolve on local disk in development and before that hostname is set up.
router.get('/uploads/{*filePath}', async (req, res) => {
  const relativePath = Array.isArray(req.params.filePath) ? req.params.filePath.join('/') : req.params.filePath
  try {
    const bytes = await getFile(`${PUBLIC_PREFIX}${relativePath}`)
    const extension = path.extname(relativePath).toLowerCase()
    res.type({ '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }[extension] ?? 'application/octet-stream')
    res.set('Cache-Control', 'public, max-age=604800, immutable')
    res.send(bytes)
  } catch {
    // Missing key, traversal attempt, or provider error — all indistinguishable to a caller.
    res.status(404).end()
  }
})
