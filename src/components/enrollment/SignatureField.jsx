import { useEffect, useRef, useState } from 'react'
import { Eraser, PenLine } from 'lucide-react'

export default function SignatureField({ onChange }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const [hasSignature, setHasSignature] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      const saved = canvas.toDataURL('image/png')
      canvas.width = Math.max(1, Math.round(rect.width * ratio))
      canvas.height = Math.max(1, Math.round(rect.height * ratio))
      const context = canvas.getContext('2d')
      context.scale(ratio, ratio)
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.strokeStyle = '#123826'
      context.lineWidth = 2.2
      if (hasSignature) {
        const image = new Image()
        image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height)
        image.src = saved
      }
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [hasSignature])

  const point = (event) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const begin = (event) => {
    event.preventDefault()
    drawing.current = true
    const context = canvasRef.current.getContext('2d')
    const { x, y } = point(event)
    context.beginPath()
    context.moveTo(x, y)
    canvasRef.current.setPointerCapture(event.pointerId)
  }
  const move = (event) => {
    if (!drawing.current) return
    const context = canvasRef.current.getContext('2d')
    const { x, y } = point(event)
    context.lineTo(x, y)
    context.stroke()
    if (!hasSignature) setHasSignature(true)
  }
  const finish = () => {
    if (!drawing.current) return
    drawing.current = false
    const dataUrl = canvasRef.current.toDataURL('image/png')
    onChange(dataUrl)
  }
  const clear = () => {
    const canvas = canvasRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
    onChange('')
  }

  return <div className="signature-field"><div className="signature-field-head"><span><PenLine size={15} /> Draw your signature</span><button type="button" onClick={clear} disabled={!hasSignature}><Eraser size={14} /> Clear</button></div><canvas ref={canvasRef} className="signature-canvas" onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} aria-label="Draw your signature with a mouse or touch" /><small>Use your mouse, trackpad, or finger. This signature is embedded in your final PDF.</small></div>
}
