import { Fragment, useEffect, useRef, useState } from 'react'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let pdfjsLibPromise
function loadPdfjsLib() {
  pdfjsLibPromise ??= import('pdfjs-dist').then((pdfjsLib) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl
    return pdfjsLib
  })
  return pdfjsLibPromise
}

// A PDF field's rect corners are transformed through the page viewport (which
// accounts for scale/rotation) rather than assumed axis-aligned in advance.
function widgetBox(viewport, rect) {
  const [x1, y1, x2, y2] = rect
  const a = viewport.convertToViewportPoint(x1, y1)
  const b = viewport.convertToViewportPoint(x2, y2)
  return { left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) }
}

function uncheckGroupSiblings(event, group) {
  const form = event.currentTarget.form
  if (!form || !group) return
  form.querySelectorAll(`input[data-pdf-group="${group}"]`).forEach((input) => { if (input !== event.currentTarget) input.checked = false })
}

export default function InteractivePdfFields({ src, fields, defaults = {}, signatureImage = '', signatureName = '' }) {
  const [pages, setPages] = useState(null)
  const [error, setError] = useState('')
  const containerRef = useRef(null)
  const canvasRefs = useRef(new Map())
  const pageProxiesRef = useRef([])

  useEffect(() => {
    let cancelled = false
    const whitelist = new Map(fields.map((field) => [field.name, field]))
    const containerWidth = containerRef.current?.clientWidth || 900

    loadPdfjsLib().then(async (pdfjsLib) => {
      if (cancelled) return
      setPages(null)
      setError('')
      try {
        const doc = await pdfjsLib.getDocument({ url: src }).promise
        const built = []
        pageProxiesRef.current = []
        for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
          const page = await doc.getPage(pageNumber)
          const unscaled = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: containerWidth / unscaled.width })
          const annotations = await page.getAnnotations({ intent: 'display' })
          const widgets = annotations
            .filter((annotation) => whitelist.has(annotation.fieldName))
            .map((annotation) => ({ ...whitelist.get(annotation.fieldName), ...widgetBox(viewport, annotation.rect) }))
          pageProxiesRef.current.push({ page, viewport })
          built.push({ pageNumber, width: viewport.width, height: viewport.height, widgets })
        }
        if (!cancelled) setPages(built)
      } catch {
        if (!cancelled) setError('Unable to load the document preview.')
      }
    })

    return () => { cancelled = true }
  }, [src, fields])

  useEffect(() => {
    if (!pages) return
    let cancelled = false
    loadPdfjsLib().then(async (pdfjsLib) => {
      for (const { page, viewport } of pageProxiesRef.current) {
        if (cancelled) return
        const canvas = canvasRefs.current.get(page.pageNumber)
        if (!canvas) continue
        const context = canvas.getContext('2d')
        await page.render({ canvasContext: context, viewport, annotationMode: pdfjsLib.AnnotationMode.DISABLE }).promise
      }
    })
    return () => { cancelled = true }
  }, [pages])

  return <div className="pdf-fields" ref={containerRef}>
    {error && <p className="form-alert" role="alert">{error}</p>}
    {!error && !pages && <p className="pdf-fields-loading">Loading document…</p>}
    {pages?.map(({ pageNumber, width, height, widgets }) => <div key={pageNumber} className="pdf-page" style={{ width, height }}>
      <canvas ref={(node) => { if (node) canvasRefs.current.set(pageNumber, node); else canvasRefs.current.delete(pageNumber) }} width={width} height={height} />
      {widgets.map((widget) => {
        const style = { left: widget.left, top: widget.top, width: widget.width, height: widget.height }
        // Signature line: overlays the drawn signature image (above the line) and the printed legal
        // name (on the line), both updating live as the learner signs below. Not a submitted input —
        // the server stamps p_signature/b_signature itself from the signature payload.
        if (widget.kind === 'signature') {
          // Kept just under the ~24pt clear gap above the signature line so the drawn signature
          // never rides up into the acceptance/clause text sitting above it.
          const imageHeight = widget.height * 1.1
          return <Fragment key={widget.name}>
            <div className="pdf-signature-image" style={{ left: widget.left, top: widget.top - imageHeight, width: widget.width, height: imageHeight }}>
              {signatureImage ? <img src={signatureImage} alt="Your signature" /> : <span>Your signature appears here as you sign below ↓</span>}
            </div>
            {signatureName ? <span className="pdf-signature-name" style={style}>{signatureName}</span> : null}
          </Fragment>
        }
        if (widget.group) return <input key={widget.name} type="checkbox" name={widget.name} data-pdf-group={widget.group} required={widget.required} defaultChecked={Boolean(defaults[widget.name])} className="pdf-field pdf-field-checkbox" style={style} onChange={(event) => uncheckGroupSiblings(event, widget.group)} />
        if (widget.multiline) return <textarea key={widget.name} name={widget.name} required={widget.required} defaultValue={defaults[widget.name] ?? ''} className="pdf-field pdf-field-text" style={style} />
        return <input key={widget.name} type={widget.type ?? 'text'} name={widget.name} required={widget.required} readOnly={widget.readOnly} defaultValue={defaults[widget.name] ?? ''} className={widget.readOnly ? 'pdf-field pdf-field-text pdf-field-readonly' : 'pdf-field pdf-field-text'} style={style} />
      })}
    </div>)}
  </div>
}
