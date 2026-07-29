import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { config } from './config.js'

const rootDirectory = path.resolve(process.cwd(), config.storage.privateDirectory)

function safePath(key) {
  const resolved = path.resolve(rootDirectory, key)
  if (!resolved.startsWith(`${rootDirectory}${path.sep}`)) throw new Error('Invalid private storage key.')
  return resolved
}

async function writeFile(key, bytes) {
  const filePath = safePath(key)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, bytes)
  return key
}

export async function saveCertificateTemplate(file) {
  const extension = file.mimetype === 'application/pdf' ? 'pdf' : file.mimetype === 'image/png' ? 'png' : 'jpg'
  const key = path.posix.join('certificate-templates', `${crypto.randomUUID()}.${extension}`)
  return writeFile(key, file.buffer)
}

export async function renderCertificate(template, learner) {
  const layout = await fs.readFile(safePath(template.fileKey))
  let document
  let page
  if (template.mimeType === 'application/pdf') {
    document = await PDFDocument.load(layout)
    page = document.getPage(0)
  } else {
    document = await PDFDocument.create()
    const image = template.mimeType === 'image/png' ? await document.embedPng(layout) : await document.embedJpg(layout)
    const pageSize = [1123, 794]
    page = document.addPage(pageSize)
    const scale = Math.min(pageSize[0] / image.width, pageSize[1] / image.height)
    const width = image.width * scale
    const height = image.height * scale
    page.drawImage(image, { x: (pageSize[0] - width) / 2, y: (pageSize[1] - height) / 2, width, height })
  }
  const font = await document.embedFont(StandardFonts.HelveticaBold)
  const position = template.namePosition ?? {}
  page.drawText(learner.name, { x: position.x ?? 260, y: position.y ?? 140, size: position.size ?? 30, font, color: rgb(0.106, 0.263, 0.18) })
  const key = path.posix.join('certificates', `${crypto.randomUUID()}.pdf`)
  return writeFile(key, await document.save())
}

export function getPrivateFilePath(key) {
  return safePath(key)
}

// Assignment submission attachments — the "drop box" upload — reuse the same private-storage
// pattern as certificate templates: never web-servable directly, only via an authorized route.
export const submissionExtensionByMime = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}
export async function saveSubmissionAttachment(file) {
  const extension = submissionExtensionByMime[file.mimetype] ?? 'bin'
  const key = path.posix.join('submission-attachments', `${crypto.randomUUID()}.${extension}`)
  return writeFile(key, file.buffer)
}
