import { useEffect, useRef } from 'react'
import { FaceLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision'
import { useSceneAnalysis } from './SceneAnalysisProvider'
import { useAiTracking } from './AiTrackingProvider'
import { useRecognition } from './RecognitionProvider'

interface Conn { start: number; end: number }

// MediaPipe's landmark connection sets — used to draw the face mesh.
const TESSELATION = FaceLandmarker.FACE_LANDMARKS_TESSELATION as Conn[]
const OVAL = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL as Conn[]
const LIPS = FaceLandmarker.FACE_LANDMARKS_LIPS as Conn[]
const FEATURES: Conn[] = [
  ...(FaceLandmarker.FACE_LANDMARKS_LEFT_EYE as Conn[]),
  ...(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE as Conn[]),
  ...(FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW as Conn[]),
  ...(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW as Conn[]),
  ...(FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS as Conn[]),
  ...(FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS as Conn[]),
]
// Body-pose skeleton connections — shoulders, arms, torso, legs.
const POSE_CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS as Conn[]

/**
 * Visualises what the scene-analysis AI sees for one camera — the MediaPipe
 * FaceLandmarker mesh drawn over the (object-contain) video, with the lips
 * glowing as the mouth opens (the signal that drives speaker detection) and
 * the tracked subject highlighted. Drop inside a relatively-positioned tile.
 */
export function AiOverlay({ index }: { index: number }) {
  const { analysisRef } = useSceneAnalysis()
  const { tracking } = useAiTracking()
  const { identities, presenceRef } = useRecognition()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trackingRef = useRef(tracking)
  trackingRef.current = tracking
  const identsRef = useRef(identities)
  identsRef.current = identities

  useEffect(() => {
    let raf = 0
    let lastSig = ''

    /** Stroke a connection set, mapping normalised mesh coords into the frame. */
    const drawConns = (
      ctx: CanvasRenderingContext2D, lm: Float32Array, conns: Conn[],
      ox: number, oy: number, cw: number, ch: number,
    ) => {
      ctx.beginPath()
      for (const c of conns) {
        const s = c.start * 2, e = c.end * 2
        ctx.moveTo(ox + lm[s] * cw, oy + lm[s + 1] * ch)
        ctx.lineTo(ox + lm[e] * cw, oy + lm[e + 1] * ch)
      }
      ctx.stroke()
    }

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const cv = canvasRef.current
      if (!cv) return
      const rect = cv.getBoundingClientRect()
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      if (w === 0 || h === 0) return
      if (cv.width !== w) cv.width = w
      if (cv.height !== h) cv.height = h

      const a = analysisRef.current[index]
      const isTracking = trackingRef.current[index]
      const pres = presenceRef.current[index] ?? []
      const identMap = new Map(identsRef.current.map(i => [i.id, i]))

      // The mesh only changes at the analysis rate (~3 Hz) — skip redundant
      // redraws so the heavy mesh draw costs almost nothing.
      const nameSig = pres.map(p => identMap.get(p.identityId)?.name ?? '').join(',')
      const sig = `${a?.updatedAt ?? 0}|${w}x${h}|${isTracking ? 1 : 0}|${nameSig}`
      if (sig === lastSig) return
      lastSig = sig

      const ctx = cv.getContext('2d')!
      ctx.clearRect(0, 0, w, h)
      if (!a || (a.faces.length === 0 && a.poses.length === 0)) return

      // The video is 16:9, shown object-contain — find its letterboxed rect.
      let cw = w
      let ch = (w * 9) / 16
      if (ch > h) { ch = h; cw = (h * 16) / 9 }
      const ox = (w - cw) / 2
      const oy = (h - ch) / 2

      const colour = isTracking ? '#22c55e' : '#3b82f6'
      const meshTint = isTracking ? '52,211,153' : '96,165,250'
      const primary = a.primary
      ctx.lineJoin = 'round'

      for (const f of a.faces) {
        const lm = f.landmarks
        const isPrimary = primary != null &&
          Math.abs((f.x + f.w / 2) - primary.cx) < 0.001 &&
          Math.abs((f.y + f.h / 2) - primary.cy) < 0.001

        if (lm && lm.length > 0) {
          // Faint tessellation — the full mesh, sitting behind the features.
          ctx.strokeStyle = `rgba(${meshTint},0.13)`
          ctx.lineWidth = 1
          drawConns(ctx, lm, TESSELATION, ox, oy, cw, ch)

          // Feature contours — face oval, eyes, brows, irises.
          ctx.strokeStyle = colour
          ctx.globalAlpha = isPrimary ? 0.9 : 0.5
          ctx.lineWidth = isPrimary ? 1.5 : 1
          drawConns(ctx, lm, OVAL, ox, oy, cw, ch)
          drawConns(ctx, lm, FEATURES, ox, oy, cw, ch)
          ctx.globalAlpha = 1

          // Lips — emphasised, glowing as the mouth opens (the speaker signal).
          const open = Math.min(1, Math.max(0, f.mouthOpen))
          ctx.strokeStyle = colour
          ctx.lineWidth = isPrimary ? 2.4 : 1.8
          ctx.shadowColor = colour
          ctx.shadowBlur = open * 14
          drawConns(ctx, lm, LIPS, ox, oy, cw, ch)
          ctx.shadowBlur = 0
        } else {
          // No mesh yet — fall back to a simple box.
          ctx.strokeStyle = colour
          ctx.lineWidth = isPrimary ? 3 : 1.5
          ctx.strokeRect(ox + f.x * cw, oy + f.y * ch, f.w * cw, f.h * ch)
        }

        // Line from frame centre to the tracked subject.
        if (isPrimary && isTracking) {
          ctx.strokeStyle = 'rgba(34,197,94,0.6)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(ox + cw / 2, oy + ch * 0.45)
          ctx.lineTo(ox + (f.x + f.w / 2) * cw, oy + (f.y + f.h / 2) * ch)
          ctx.stroke()
        }

        // Identity label — who recognition believes this face is.
        const fcx = f.x + f.w / 2
        const fcy = f.y + f.h / 2
        let pid: string | null = null
        let pdist = 0.1
        for (const p of pres) {
          const d = Math.hypot(p.cx - fcx, p.cy - fcy)
          if (d < pdist) { pdist = d; pid = p.identityId }
        }
        const ident = pid ? identMap.get(pid) : undefined
        if (ident) {
          ctx.font = '700 10px sans-serif'
          const chipW = ctx.measureText(ident.name).width + 22
          const chipH = 16
          let chipX = ox + fcx * cw - chipW / 2
          chipX = Math.max(ox, Math.min(chipX, ox + cw - chipW))
          const chipY = Math.max(oy, oy + f.y * ch - chipH - 5)
          ctx.fillStyle = 'rgba(0,0,0,0.72)'
          ctx.fillRect(chipX, chipY, chipW, chipH)
          ctx.fillStyle = ident.color
          ctx.beginPath()
          ctx.arc(chipX + 9, chipY + chipH / 2, 3, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = '#fff'
          ctx.textBaseline = 'middle'
          ctx.fillText(ident.name, chipX + 16, chipY + chipH / 2 + 0.5)
        }
      }

      // Body-pose skeletons — drawn in amber so they read distinctly from the
      // blue/green face mesh. Shows everyone the pose model found, face or not.
      ctx.lineCap = 'round'
      for (const ps of a.poses) {
        const lm = ps.landmarks
        if (!lm || lm.length < 4) continue
        ctx.strokeStyle = 'rgba(251,191,36,0.9)'
        ctx.lineWidth = 2.5
        ctx.shadowColor = 'rgba(251,191,36,0.6)'
        ctx.shadowBlur = 6
        drawConns(ctx, lm, POSE_CONNECTIONS, ox, oy, cw, ch)
        ctx.shadowBlur = 0
        ctx.fillStyle = '#fbbf24'
        for (let p = 0; p < lm.length; p += 2) {
          ctx.beginPath()
          ctx.arc(ox + lm[p] * cw, oy + lm[p + 1] * ch, 2.4, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.lineCap = 'butt'

      // Count chip.
      ctx.font = '600 11px sans-serif'
      const label = `${a.people} seen${isTracking ? ' · tracking' : ''}`
      const tw = ctx.measureText(label).width
      ctx.fillStyle = isTracking ? 'rgba(34,197,94,0.85)' : 'rgba(59,130,246,0.85)'
      ctx.fillRect(ox + 4, oy + 4, tw + 12, 18)
      ctx.fillStyle = '#000'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, ox + 10, oy + 14)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [index])

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
}
