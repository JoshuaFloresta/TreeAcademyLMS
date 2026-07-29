import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { config } from './config.js'

const storageRoot = path.resolve(process.cwd(), config.storage.privateDirectory)
const templateRoot = path.resolve(process.cwd(), 'server/templates')

function safeStoragePath(key) {
  const resolved = path.resolve(storageRoot, key)
  if (!resolved.startsWith(`${storageRoot}${path.sep}`)) throw new Error('Invalid enrollment document path.')
  return resolved
}

async function savePdf(kind, bytes) {
  const key = path.posix.join('enrollments', `${crypto.randomUUID()}-${kind}.pdf`)
  const filePath = safeStoragePath(key)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, bytes)
  return key
}

const clean = (value) => typeof value === 'string' ? value.trim() : ''
const yes = (value) => value === true || value === 'true'

function decodeSignature(signatureDataUrl) {
  if (!/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(signatureDataUrl ?? '')) throw new Error('The signature image is invalid.')
  return Buffer.from(signatureDataUrl.slice(signatureDataUrl.indexOf(',') + 1), 'base64')
}

async function addSignaturePage(pdf, { signatureDataUrl, signatureName, title }) {
  const page = pdf.addPage([595.28, 841.89])
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  page.drawText('TREE ACADEMY — ELECTRONIC ACKNOWLEDGMENT', { x: 55, y: 760, size: 12, font: bold, color: rgb(0.05, 0.3, 0.22) })
  page.drawText(title, { x: 55, y: 726, size: 18, font: bold, color: rgb(0.09, 0.13, 0.11) })
  page.drawText('The participant completed this document electronically and confirmed the declaration shown in the document.', { x: 55, y: 690, size: 10, font: regular, color: rgb(0.22, 0.27, 0.24), maxWidth: 480, lineHeight: 15 })
  page.drawText('Electronic signature', { x: 55, y: 575, size: 10, font: bold, color: rgb(0.22, 0.27, 0.24) })
  page.drawLine({ start: { x: 55, y: 480 }, end: { x: 330, y: 480 }, thickness: 1, color: rgb(0.56, 0.62, 0.58) })
  const signature = await pdf.embedPng(decodeSignature(signatureDataUrl))
  const scale = Math.min(260 / signature.width, 80 / signature.height)
  page.drawImage(signature, { x: 60, y: 493, width: signature.width * scale, height: signature.height * scale })
  page.drawText(clean(signatureName), { x: 55, y: 455, size: 11, font: bold, color: rgb(0.09, 0.13, 0.11) })
  page.drawText(`Signed on ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'long', timeStyle: 'short' })}`, { x: 55, y: 430, size: 9, font: regular, color: rgb(0.33, 0.39, 0.35) })
}

function setText(form, name, value) {
  const text = clean(value)
  if (text) form.getTextField(name).setText(text)
}

function findWidgetPage(pdf, widgetDict) {
  for (const page of pdf.getPages()) {
    const annots = page.node.Annots()
    if (!annots) continue
    for (let i = 0; i < annots.size(); i += 1) {
      if (page.node.context.lookup(annots.get(i)) === widgetDict) return page
    }
  }
  return pdf.getPages()[0]
}

// Stamps the drawn signature image directly above the named signature line so the stored PDF matches
// what the learner saw signed in the live preview (the printed name is set separately via setText).
async function stampSignatureImage(pdf, form, fieldName, signatureDataUrl) {
  const widget = form.getTextField(fieldName).acroField.getWidgets()[0]
  const rect = widget.getRectangle()
  const page = findWidgetPage(pdf, widget.dict)
  const image = await pdf.embedPng(decodeSignature(signatureDataUrl))
  // Kept just under the ~24pt clear gap above the signature line so the stamped signature never
  // rides up into the acceptance/clause text sitting above it (matches the live preview).
  const boxHeight = rect.height * 1.1
  const scale = Math.min(rect.width / image.width, boxHeight / image.height)
  const width = image.width * scale
  const height = image.height * scale
  page.drawImage(image, { x: rect.x + (rect.width - width) / 2, y: rect.y + rect.height, width, height })
}

function check(form, name, isChecked) {
  const field = form.getCheckBox(name)
  if (isChecked) field.check()
  else field.uncheck()
}

export async function createApplicationPdf({ data }) {
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const entries = Object.entries(data)
    .filter(([key]) => !key.startsWith('admin_'))
    .map(([key, value]) => [key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()), typeof value === 'boolean' ? (value ? 'Yes' : 'No') : clean(value)])
    .filter(([, value]) => value)

  let page = pdf.addPage([595.28, 841.89])
  let y = 780
  const newPage = () => {
    page = pdf.addPage([595.28, 841.89])
    y = 780
    page.drawText('PASS-FIRST REBLEX 2027 APPLICATION AND ENROLLMENT', { x: 45, y, size: 11, font: bold, color: rgb(0.05, 0.3, 0.22) })
    y -= 30
  }
  page.drawText('TREE ACADEMY • PASS-FIRST REVIEW PROGRAM', { x: 45, y, size: 11, font: bold, color: rgb(0.05, 0.3, 0.22) })
  y -= 30
  page.drawText('REBLEX 2027 Application and Enrollment Form', { x: 45, y, size: 19, font: bold, color: rgb(0.09, 0.13, 0.11) })
  y -= 32
  for (const [label, value] of entries) {
    if (y < 75) newPage()
    page.drawText(label.toUpperCase(), { x: 45, y, size: 7.5, font: bold, color: rgb(0.35, 0.42, 0.38) })
    y -= 12
    const lines = value.match(/.{1,85}(?:\s|$)|\S+?\s*/g) ?? [value]
    for (const line of lines) {
      if (y < 55) newPage()
      page.drawText(line.trim(), { x: 45, y, size: 10, font: regular, color: rgb(0.1, 0.14, 0.12) })
      y -= 14
    }
    y -= 7
  }
  return savePdf('application', await pdf.save())
}

export async function createFilledDocumentBytes({ type, fields, signatureDataUrl, signatureName }) {
  const templateName = type === 'realex-reblex' ? 'realex-reblex.pdf' : 'reclex.pdf'
  const template = await fs.readFile(path.join(templateRoot, templateName))
  const pdf = await PDFDocument.load(template)
  const form = pdf.getForm()
  const font = await pdf.embedFont(StandardFonts.Helvetica)

  if (type === 'realex-reblex') {
    check(form, 'exam_reblex', fields.exam_type === 'REBLEX')
    check(form, 'exam_realex', fields.exam_type === 'REALEX')
    setText(form, 'p_name', fields.p_name)
    setText(form, 'p_address', fields.p_address)
    setText(form, 'p_contact', fields.p_contact)
    setText(form, 'p_email', fields.p_email)
    setText(form, 'p_prc_app', fields.p_prc_app)
    setText(form, 'p_signature', signatureName)
    setText(form, 'p_date', fields.p_date)
    setText(form, 'prov_date', fields.prov_date)
    await stampSignatureImage(pdf, form, 'p_signature', signatureDataUrl)
  } else {
    for (const name of ['agmt_no', 'agmt_date', 'agmt_place', 'r_name', 'r_lic_type', 'r_lic_no', 'r_contact', 'r_email', 'r_address', 'r_target_exam', 'a_date', 'w1_name', 'w2_name']) setText(form, name, fields[name])
    setText(form, 'b_signature', signatureName)
    setText(form, 'b_date', fields.b_date)
    await stampSignatureImage(pdf, form, 'b_signature', signatureDataUrl)
  }
  form.updateFieldAppearances(font)
  form.flatten()
  await addSignaturePage(pdf, { signatureDataUrl, signatureName, title: type === 'realex-reblex' ? 'REALEX / REBLEX Enrollment Document' : 'RECLEX Agreement' })
  return pdf.save()
}

export async function createFilledDocument({ type, fields, signatureDataUrl, signatureName }) {
  const bytes = await createFilledDocumentBytes({ type, fields, signatureDataUrl, signatureName })
  return savePdf(type, bytes)
}

export const isTruthy = yes
