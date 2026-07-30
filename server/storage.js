import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'

// Dual-mode file storage. Local disk keeps `npm run dev:api` working with zero external services;
// an S3-compatible bucket (Cloudflare R2, AWS S3, Backblaze B2, MinIO…) takes over as soon as the
// S3_* env vars are set, which is required on hosts with an ephemeral filesystem (Render, Vercel,
// Fly) where anything written to disk is lost on every restart or redeploy.
//
// Keys are provider-agnostic POSIX paths (e.g. `enrollments/<uuid>-reclex.pdf`). Only the key is
// ever persisted in Mongo — never a full URL — so switching providers never invalidates old rows.
// Objects under the `public/` prefix are the only ones ever exposed by URL (avatars, course
// banners); everything else stays private and is streamed through an authorized Express route.

export const PUBLIC_PREFIX = 'public/'
export const isObjectStorage = Boolean(config.storage.s3.bucket && config.storage.s3.accessKeyId)

// Object storage providers grant public read access per *bucket*, not per prefix — switching on
// R2's r2.dev subdomain (or an S3 public policy) exposes every object in that bucket. The main
// bucket therefore always stays private, and avatars/banners only move to a second, deliberately
// public bucket when S3_PUBLIC_BUCKET is set. Unset (the default) keeps everything private and
// serves those images through this API's own /uploads route instead.
const publicBucket = config.storage.s3.publicBucket
const isPublicKey = (key) => key.startsWith(PUBLIC_PREFIX)
const bucketFor = (key) => (publicBucket && isPublicKey(key) ? publicBucket : config.storage.s3.bucket)

const rootDirectory = path.resolve(process.cwd(), config.storage.privateDirectory)

// Guards against `..` traversal escaping the storage root — applies to the disk backend only,
// but the same validation runs for S3 keys so a malformed key can never reach the provider.
function assertSafeKey(key) {
  if (typeof key !== 'string' || !key || key.includes('\\') || key.includes('\0')) throw new Error('Invalid storage key.')
  const normalized = path.posix.normalize(key)
  if (normalized.startsWith('..') || normalized.startsWith('/') || path.posix.isAbsolute(normalized)) throw new Error('Invalid storage key.')
  return normalized
}

function diskPath(key) {
  const resolved = path.resolve(rootDirectory, assertSafeKey(key))
  if (!resolved.startsWith(`${rootDirectory}${path.sep}`)) throw new Error('Invalid storage key.')
  return resolved
}

// The S3 client is created lazily so local development never pays the import cost and never needs
// credentials. R2 requires forcePathStyle; it is harmless on AWS S3.
let clientPromise = null
function s3Client() {
  clientPromise ??= import('@aws-sdk/client-s3').then(({ S3Client }) => new S3Client({
    region: config.storage.s3.region,
    endpoint: config.storage.s3.endpoint || undefined,
    forcePathStyle: true,
    credentials: { accessKeyId: config.storage.s3.accessKeyId, secretAccessKey: config.storage.s3.secretAccessKey },
  }))
  return clientPromise
}

export const randomKey = (folder, extension) => path.posix.join(folder, `${crypto.randomUUID()}.${extension}`)

export async function putFile(key, bytes, contentType = 'application/octet-stream') {
  const safeKey = assertSafeKey(key)
  if (!isObjectStorage) {
    const filePath = diskPath(safeKey)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, bytes)
    return safeKey
  }
  const { PutObjectCommand } = await import('@aws-sdk/client-s3')
  const client = await s3Client()
  await client.send(new PutObjectCommand({
    Bucket: bucketFor(safeKey),
    Key: safeKey,
    Body: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
    ContentType: contentType,
  }))
  return safeKey
}

export async function getFile(key) {
  const safeKey = assertSafeKey(key)
  if (!isObjectStorage) return fs.readFile(diskPath(safeKey))
  const { GetObjectCommand } = await import('@aws-sdk/client-s3')
  const client = await s3Client()
  const result = await client.send(new GetObjectCommand({ Bucket: bucketFor(safeKey), Key: safeKey }))
  return Buffer.from(await result.Body.transformToByteArray())
}

// Public assets (avatars, course banners). When the bucket is fronted by a CDN/public hostname the
// browser fetches straight from it; otherwise callers fall back to the API's own /uploads route so
// the feature still works before a public hostname is configured.
export function publicUrl(key) {
  const safeKey = assertSafeKey(key)
  const base = config.storage.s3.publicBaseUrl
  // Only hand out a direct bucket URL when the asset really lives in the separate public bucket.
  // Without that second bucket the object sits alongside signed agreements in the private one, so
  // fall back to the API route rather than advertising a URL that would require exposing them.
  if (isObjectStorage && base && publicBucket && isPublicKey(safeKey)) return `${base.replace(/\/$/, '')}/${safeKey}`
  return `/${isPublicKey(safeKey) ? `uploads/${safeKey.slice(PUBLIC_PREFIX.length)}` : safeKey}`
}
