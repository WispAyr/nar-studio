import { useEffect, useRef } from 'react'
import { useEngine } from '../../engine/EngineProvider'

/**
 * Large program-output monitor. For the built-in engine it mirrors the
 * compositor canvas; for OBS it shows the live scene name (OBS does not expose
 * a video feed over the websocket).
 */
export function ProgramMonitor() {
  const { engineId, getProgramCanvas, programSource, sources, recording, streamStatus, autoVj } = useEngine()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (engineId !== 'builtin') return
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const dst = canvasRef.current
      const src = getProgramCanvas()
      if (!dst || !src) return
      const rect = dst.getBoundingClientRect()
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      if (w === 0 || h === 0) return
      if (dst.width !== w || dst.height !== h) {
        dst.width = w
        dst.height = h
      }
      const ctx = dst.getContext('2d')!
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, w, h)
      const scale = Math.min(w / src.width, h / src.height)
      const dw = src.width * scale
      const dh = src.height * scale
      ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [engineId, getProgramCanvas])

  const activeLabel = sources.find(s => s.key === programSource)?.label || programSource || '—'

  return (
    <div className="relative h-full bg-black rounded border-2 border-nar-red overflow-hidden flex items-center justify-center">
      {engineId === 'builtin' ? (
        <canvas ref={canvasRef} className="w-full h-full" />
      ) : (
        <div className="text-center">
          <div className="text-slate-600 text-xs uppercase tracking-wider mb-1">OBS Program</div>
          <div className="text-white text-2xl font-bold">{activeLabel}</div>
        </div>
      )}

      <div className="absolute top-2 left-2 flex items-center gap-1.5 pointer-events-none">
        <span className="text-xs font-bold bg-nar-red text-white px-2 py-0.5 rounded animate-pulse">PROGRAM</span>
        <span className="text-xs font-bold bg-black/60 text-white px-2 py-0.5 rounded">{activeLabel}</span>
      </div>

      <div className="absolute top-2 right-2 flex items-center gap-1.5 pointer-events-none">
        {autoVj && (
          <span className="text-xs font-bold bg-nar-green text-black px-2 py-0.5 rounded animate-pulse">
            ⏵ AUTO-VJ
          </span>
        )}
        {recording && (
          <span className="text-xs font-bold bg-nar-red text-white px-2 py-0.5 rounded">● REC</span>
        )}
        {streamStatus === 'live' && (
          <span className="text-xs font-bold bg-nar-red text-white px-2 py-0.5 rounded">● LIVE</span>
        )}
        {streamStatus === 'reconnecting' && (
          <span className="text-xs font-bold bg-nar-amber text-black px-2 py-0.5 rounded animate-pulse">
            ● RECONNECTING
          </span>
        )}
        {streamStatus === 'lost' && (
          <span className="text-xs font-bold bg-nar-red text-white px-2 py-0.5 rounded animate-pulse">
            ● STREAM LOST
          </span>
        )}
      </div>
    </div>
  )
}
