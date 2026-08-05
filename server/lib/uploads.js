import multer from 'multer'
import { submissionExtensionByMime } from '../certificates.js'
import { PUBLIC_PREFIX, publicUrl, putFile, randomKey } from '../storage.js'

export const certificateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, ['application/pdf', 'image/png', 'image/jpeg'].includes(file.mimetype)),
})

// A course's optional fillable/signable agreement PDF (see Course.agreementTemplate) — PDF only,
// since its AcroForm fields are read directly off the file at upload time.
export const agreementTemplateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, file.mimetype === 'application/pdf'),
})

// Avatars are public-facing images (unlike signed PDFs, which stay in private storage), so they're
// written to a dedicated static-served directory and referenced by URL, not by object key.
const avatarMimeExtension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

// Avatars and banners are the only web-servable uploads (signed PDFs and certificates stay
// private). They live under the storage layer's `public/` prefix and are referenced by URL —
// absolute when a public bucket hostname is configured, otherwise relative to this API's
// /uploads route, which `avatarSrc()` on the client resolves against the API origin.
async function savePublicImage(folder, file) {
  const key = await putFile(randomKey(`${PUBLIC_PREFIX}${folder}`, avatarMimeExtension[file.mimetype]), file.buffer, file.mimetype)
  return publicUrl(key)
}

export const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, Boolean(avatarMimeExtension[file.mimetype])),
})
export const saveAvatarUpload = (file) => savePublicImage('avatars', file)

// Course banners follow the same public-image pattern as avatars.
export const bannerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, Boolean(avatarMimeExtension[file.mimetype])),
})
export const saveBannerUpload = (file) => savePublicImage('banners', file)

// Images attached to a discussion thread or reply — same public-image pattern as avatars/banners.
export const forumImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, Boolean(avatarMimeExtension[file.mimetype])),
})
export const saveForumImageUpload = (file) => savePublicImage('forum', file)

// Assignment submission attachments (the "drop box") — private storage, same as certificates.
export const submissionUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, Boolean(submissionExtensionByMime[file.mimetype])),
})
