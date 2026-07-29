import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { getFile, putFile, randomKey } from './storage.js'

export async function saveCertificateTemplate(file) {
  const extension = file.mimetype === 'application/pdf' ? 'pdf' : file.mimetype === 'image/png' ? 'png' : 'jpg'
  return putFile(randomKey('certificate-templates', extension), file.buffer, file.mimetype)
}

export async function renderCertificate(template, learner) {
  const layout = await getFile(template.fileKey)
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
  return putFile(randomKey('certificates', 'pdf'), await document.save(), 'application/pdf')
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
  return putFile(randomKey('submission-attachments', extension), file.buffer, file.mimetype)
}
