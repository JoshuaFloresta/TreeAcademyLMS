import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'
import { PUBLIC_PREFIX, isObjectStorage, putFile } from './storage.js'

// One-time migration into the storage layer (server/storage.js). Two jobs, both idempotent:
//
//  1. Relocates legacy public uploads from server/public-uploads/{avatars,banners} to the storage
//     layer's `public/` prefix. The URLs saved in Mongo (/uploads/avatars/<file>) are unchanged —
//     only where the bytes live moves — so no database update is needed.
//  2. When S3_* is configured, uploads everything already in the local private-storage directory
//     (signed agreements, certificates, submission attachments) into the bucket, so a local
//     database can be pointed at a deployed API without losing its existing documents.
//
// Usage:
//   node server/migrate-storage.js            # copy legacy public uploads into place
//   S3_BUCKET=... node server/migrate-storage.js   # ...and push private files to the bucket
//
// Safe to re-run: sources are only read, never deleted, so a failed run can simply be repeated.

const contentTypeByExtension = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}
const contentType = (file) => contentTypeByExtension[path.extname(file).toLowerCase()] ?? 'application/octet-stream'

async function listFiles(directory, prefix = '') {
  let entries
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const found = []
  for (const entry of entries) {
    const relative = prefix ? path.posix.join(prefix, entry.name) : entry.name
    if (entry.isDirectory()) found.push(...await listFiles(path.join(directory, entry.name), relative))
    else found.push({ absolute: path.join(directory, entry.name), relative })
  }
  return found
}

async function copyInto(sourceDirectory, keyPrefix, label) {
  const files = await listFiles(sourceDirectory)
  if (!files.length) return console.log(`${label}: nothing to migrate.`)
  let migrated = 0
  for (const file of files) {
    await putFile(path.posix.join(keyPrefix, file.relative), await fs.readFile(file.absolute), contentType(file.relative))
    migrated += 1
  }
  console.log(`${label}: migrated ${migrated} file${migrated === 1 ? '' : 's'}.`)
}

async function main() {
  console.log(isObjectStorage ? `Target: S3 bucket "${config.storage.s3.bucket}"` : `Target: local disk (${config.storage.privateDirectory})`)

  const legacyPublic = path.resolve(process.cwd(), 'server', 'public-uploads')
  await copyInto(path.join(legacyPublic, 'avatars'), `${PUBLIC_PREFIX}avatars`, 'Avatars')
  await copyInto(path.join(legacyPublic, 'banners'), `${PUBLIC_PREFIX}banners`, 'Banners')

  if (isObjectStorage) {
    // Only meaningful when uploading to a bucket — on disk the source and destination are the same.
    const privateRoot = path.resolve(process.cwd(), config.storage.privateDirectory)
    const files = (await listFiles(privateRoot)).filter((file) => !file.relative.startsWith(PUBLIC_PREFIX))
    let uploaded = 0
    for (const file of files) {
      await putFile(file.relative, await fs.readFile(file.absolute), contentType(file.relative))
      uploaded += 1
    }
    console.log(`Private documents: uploaded ${uploaded} file${uploaded === 1 ? '' : 's'} to the bucket.`)
  } else {
    console.log('Private documents: skipped (no S3 bucket configured — they are already on local disk).')
  }
  console.log('Done. The legacy server/public-uploads directory can be deleted once you have verified avatars still load.')
}

main().catch((error) => { console.error(error); process.exit(1) })
