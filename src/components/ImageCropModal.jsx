import { useEffect, useRef, useState } from 'react'
import { X, ZoomIn } from 'lucide-react'

// Facebook-style crop step shown between picking a file and uploading it: drag to
// reposition, use the slider to zoom, then confirm to get back a cropped Blob.
// Remount this per file (e.g. `{pendingFile && <ImageCropModal file={pendingFile} .../>}`)
// so a newly picked file always starts from a fresh zoom/offset.
export default function ImageCropModal({ file, aspect = 1, shape = 'rect', outputWidth = 640, onCancel, onConfirm }) {
  const viewportRef = useRef(null)
  const imgRef = useRef(null)
  const dragRef = useRef(null)
  const [natural, setNatural] = useState(null)
  const [viewportSize, setViewportSize] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)

  // Assigned imperatively (not via React state) so the create/revoke pair always
  // stays matched even under StrictMode's mount->cleanup->mount dev simulation —
  // storing the URL in state and revoking it from a separate effect let the
  // cleanup revoke the blob the <img> was still loading.
  useEffect(() => {
    const url = URL.createObjectURL(file)
    if (imgRef.current) imgRef.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  const baseScale = natural && viewportSize ? Math.max(viewportSize.width / natural.width, viewportSize.height / natural.height) : 1

  const clampOffset = (next, scale) => {
    if (!viewportSize || !natural) return next
    const displayedW = natural.width * scale
    const displayedH = natural.height * scale
    const maxX = Math.max(0, (displayedW - viewportSize.width) / 2)
    const maxY = Math.max(0, (displayedH - viewportSize.height) / 2)
    return { x: Math.min(maxX, Math.max(-maxX, next.x)), y: Math.min(maxY, Math.max(-maxY, next.y)) }
  }

  const onImageLoad = (event) => {
    const viewport = viewportRef.current.getBoundingClientRect()
    setViewportSize({ width: viewport.width, height: viewport.height })
    setNatural({ width: event.target.naturalWidth, height: event.target.naturalHeight })
  }

  const startDrag = (event) => {
    event.preventDefault()
    const point = event.touches ? event.touches[0] : event
    dragRef.current = { startX: point.clientX, startY: point.clientY, origin: offset }
  }
  const onDrag = (event) => {
    if (!dragRef.current) return
    const point = event.touches ? event.touches[0] : event
    const dx = point.clientX - dragRef.current.startX
    const dy = point.clientY - dragRef.current.startY
    const scale = baseScale * zoom
    setOffset(clampOffset({ x: dragRef.current.origin.x + dx, y: dragRef.current.origin.y + dy }, scale))
  }
  const endDrag = () => { dragRef.current = null }

  const changeZoom = (nextZoom) => {
    setZoom(nextZoom)
    setOffset((current) => clampOffset(current, baseScale * nextZoom))
  }

  const confirm = async () => {
    if (!viewportSize || !natural) return
    setBusy(true)
    const scale = baseScale * zoom
    const centerNaturalX = natural.width / 2 - offset.x / scale
    const centerNaturalY = natural.height / 2 - offset.y / scale
    const srcW = viewportSize.width / scale
    const srcH = viewportSize.height / scale
    const outW = outputWidth
    const outH = Math.round(outputWidth / aspect)
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    ctx.drawImage(imgRef.current, centerNaturalX - srcW / 2, centerNaturalY - srcH / 2, srcW, srcH, 0, 0, outW, outH)
    const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
    canvas.toBlob((blob) => {
      setBusy(false)
      if (blob) onConfirm(new File([blob], file.name, { type: mimeType }))
    }, mimeType, 0.92)
  }

  const scale = baseScale * zoom
  const clipStyle = shape === 'circle'
    // Avatar images are saved as a square and displayed through a circular CSS
    // clip. Keep the guide inscribed in that exact square so the visible avatar
    // is the same composition the user selected, rather than an inset crop.
    ? { inset: 0, borderRadius: '50%', boxShadow: '0 0 0 9999px rgba(20, 26, 20, .6)' }
    : { display: 'none' }

  return <div className="modal-backdrop" role="dialog" aria-modal="true">
    <div className="modal-panel image-crop-modal">
      <div className="image-crop-header">
        <h3>Adjust photo</h3>
        <button type="button" className="image-crop-close" onClick={onCancel} aria-label="Cancel"><X size={18} /></button>
      </div>
      <div
        ref={viewportRef}
        className="image-crop-viewport"
        style={{ aspectRatio: aspect }}
        onMouseDown={startDrag} onMouseMove={onDrag} onMouseUp={endDrag} onMouseLeave={endDrag}
        onTouchStart={startDrag} onTouchMove={onDrag} onTouchEnd={endDrag}
      >
        <img
          ref={imgRef}
          alt=""
          onLoad={onImageLoad}
          draggable={false}
          className="image-crop-img"
          style={natural ? { width: natural.width, height: natural.height, transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})` } : { opacity: 0 }}
        />
        <div className="image-crop-mask" style={clipStyle} />
      </div>
      <label className="image-crop-zoom">
        <ZoomIn size={14} />
        <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => changeZoom(Number(event.target.value))} disabled={!natural} />
      </label>
      <div className="image-crop-actions">
        <button type="button" className="button button-outline" onClick={onCancel}>Cancel</button>
        <button type="button" className="button" onClick={confirm} disabled={!natural || busy}>{busy ? 'Saving…' : 'Save photo'}</button>
      </div>
    </div>
  </div>
}
