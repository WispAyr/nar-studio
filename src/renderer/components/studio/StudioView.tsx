import { useEffect, useRef, useState } from 'react'
import { useSceneAnalysis } from '../../ai/SceneAnalysisProvider'
import { useRecognition } from '../../ai/RecognitionProvider'

/**
 * Studio map — a top-down schematic of the studio. The operator drags the four
 * cameras to match the real room and aims each one; the view then draws each
 * camera's field of view, a sightline to every detected person, and a confirmed
 * dot where a recognised presenter is triangulated by two or more cameras.
 *
 * It is deliberately an *approximate* operator aid: positions come from the
 * operator's camera layout plus where people sit in each frame — not survey-
 * grade measurement. It needs no camera calibration and no PTZ readback.
 */

interface CamPlacement {
  /** Position in the room, normalised 0..1. */
  x: number
  y: number
  /** Direction the camera looks, radians (screen space, 0 = +x). */
  angle: number
}

// OBSBot Tiny 2 horizontal field of view (wide), ~77°.
const FOV = 1.34
const HANDLE_LEN = 52   // px from camera body to its aim handle
const CAM_R = 15        // px camera body radius

const DEFAULT_CAMERAS: CamPlacement[] = [
  { x: 0.30, y: 0.06, angle: Math.PI / 2 },
  { x: 0.70, y: 0.06, angle: Math.PI / 2 },
  { x: 0.06, y: 0.62, angle: 0 },
  { x: 0.94, y: 0.62, angle: Math.PI },
]

const CAM_COLOURS = ['#e8003c', '#f59e0b', '#22c55e', '#5b8dff']

function loadCameras(): CamPlacement[] {
  try {
    const raw = localStorage.getItem('nar-studio-cams')
    if (raw) {
      const a = JSON.parse(raw)
      if (Array.isArray(a) && a.length === 4) {
        return a.map((c, i) => ({
          x: typeof c?.x === 'number' ? c.x : DEFAULT_CAMERAS[i].x,
          y: typeof c?.y === 'number' ? c.y : DEFAULT_CAMERAS[i].y,
          angle: typeof c?.angle === 'number' ? c.angle : DEFAULT_CAMERAS[i].angle,
        }))
      }
    }
  } catch { /* fall through to defaults */ }
  return DEFAULT_CAMERAS.map(c => ({ ...c }))
}

function saveCameras(c: CamPlacement[]): void {
  try { localStorage.setItem('nar-studio-cams', JSON.stringify(c)) } catch { /* ignore */ }
}

interface Vec { x: number; y: number }

function roomOf(w: number, h: number) {
  const m = Math.min(w, h) * 0.09
  return { x: m, y: m, w: w - 2 * m, h: h - 2 * m }
}

/** Intersection of ray (p1,d1) with ray (p2,d2), only when both point forward. */
function intersectRays(p1: Vec, d1: Vec, p2: Vec, d2: Vec): Vec | null {
  const det = d1.x * -d2.y - -d2.x * d1.y
  if (Math.abs(det) < 1e-6) return null
  const ex = p2.x - p1.x, ey = p2.y - p1.y
  const s = (ex * -d2.y - -d2.x * ey) / det
  const t = (d1.x * ey - d1.y * ex) / det
  if (s <= 0 || t <= 0) return null
  return { x: p1.x + s * d1.x, y: p1.y + s * d1.y }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function StudioView({ onExit }: { onExit: () => void }) {
  const { analysisRef } = useSceneAnalysis()
  const { presenceRef, identities } = useRecognition()
  const [cams, setCams] = useState<CamPlacement[]>(loadCameras)
  const camsRef = useRef(cams)
  camsRef.current = cams
  const identsRef = useRef(identities)
  identsRef.current = identities
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ cam: number; mode: 'move' | 'aim' } | null>(null)

  const resetLayout = () => {
    const d = DEFAULT_CAMERAS.map(c => ({ ...c }))
    setCams(d)
    saveCameras(d)
  }

  // ── render loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    let raf = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const rect = cv.getBoundingClientRect()
      const w = Math.round(rect.width), h = Math.round(rect.height)
      if (w === 0 || h === 0) return
      if (cv.width !== w) cv.width = w
      if (cv.height !== h) cv.height = h
      const ctx = cv.getContext('2d')!
      const room = roomOf(w, h)
      const diag = Math.hypot(room.w, room.h)
      const camPx = (c: CamPlacement): Vec => ({
        x: room.x + c.x * room.w,
        y: room.y + c.y * room.h,
      })

      // backdrop + room outline + grid
      ctx.fillStyle = '#070708'
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = '#2a2a31'
      ctx.lineWidth = 1
      for (let i = 1; i < 6; i++) {
        const gx = room.x + (room.w * i) / 6
        const gy = room.y + (room.h * i) / 6
        ctx.beginPath(); ctx.moveTo(gx, room.y); ctx.lineTo(gx, room.y + room.h); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(room.x, gy); ctx.lineTo(room.x + room.w, gy); ctx.stroke()
      }
      ctx.strokeStyle = '#3f3f47'
      ctx.lineWidth = 2
      ctx.strokeRect(room.x, room.y, room.w, room.h)

      const camList = camsRef.current

      // ── camera field-of-view cones ─────────────────────────────────────────
      camList.forEach((c, i) => {
        const p = camPx(c)
        const len = diag * 0.62
        const colour = CAM_COLOURS[i]
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.arc(p.x, p.y, len, c.angle - FOV / 2, c.angle + FOV / 2)
        ctx.closePath()
        ctx.fillStyle = colour + '14'
        ctx.fill()
        ctx.strokeStyle = colour + '40'
        ctx.lineWidth = 1
        ctx.stroke()
      })

      // ── per-camera sightlines to each detected person ──────────────────────
      camList.forEach((c, i) => {
        const p = camPx(c)
        const colour = CAM_COLOURS[i]
        const a = analysisRef.current[i]
        if (!a) return
        const seen: { cx: number; dist: number; kind: 'face' | 'body' }[] = []
        for (const f of a.faces) {
          const cx = f.x + f.w / 2
          const dist = clamp(diag * 0.085 / Math.max(0.05, f.h || f.w), diag * 0.06, diag * 0.58)
          seen.push({ cx, dist, kind: 'face' })
        }
        for (const ps of a.poses) {
          // skip a body that lines up with a face already drawn
          if (seen.some(s => Math.abs(s.cx - ps.shoulderX) < 0.12)) continue
          const dist = clamp(diag * 0.34 / Math.max(0.1, ps.h), diag * 0.06, diag * 0.58)
          seen.push({ cx: ps.shoulderX, dist, kind: 'body' })
        }
        for (const s of seen) {
          const bearing = c.angle + (s.cx - 0.5) * FOV
          const dx = Math.cos(bearing), dy = Math.sin(bearing)
          const ex = p.x + dx * s.dist, ey = p.y + dy * s.dist
          ctx.strokeStyle = colour + '55'
          ctx.lineWidth = 1.5
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(ex, ey); ctx.stroke()
          if (s.kind === 'face') {
            ctx.fillStyle = colour + 'cc'
            ctx.beginPath(); ctx.arc(ex, ey, 4.5, 0, Math.PI * 2); ctx.fill()
          } else {
            // body-only (pose) detection — a hollow ring
            ctx.strokeStyle = colour + 'cc'
            ctx.lineWidth = 2
            ctx.beginPath(); ctx.arc(ex, ey, 5, 0, Math.PI * 2); ctx.stroke()
          }
        }
      })

      // ── confirmed people — recognised identities triangulated by 2+ cams ───
      const presence = presenceRef.current
      for (const ident of identsRef.current) {
        const hits: { cam: number; cx: number }[] = []
        for (let cam = 0; cam < 4; cam++) {
          const e = presence[cam]?.find(p => p.identityId === ident.id)
          if (e) hits.push({ cam, cx: e.cx })
        }
        if (hits.length < 2) continue
        const ray = (hit: { cam: number; cx: number }) => {
          const c = camList[hit.cam]
          const p = camPx(c)
          const bearing = c.angle + (hit.cx - 0.5) * FOV
          return { p, d: { x: Math.cos(bearing), y: Math.sin(bearing) } }
        }
        const r1 = ray(hits[0]), r2 = ray(hits[1])
        const pt = intersectRays(r1.p, r1.d, r2.p, r2.d)
        if (!pt) continue
        // person dot
        ctx.fillStyle = ident.color
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 9, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = '#0b0b0d'
        ctx.lineWidth = 2
        ctx.stroke()
        // name chip
        ctx.font = '700 11px sans-serif'
        const tw = ctx.measureText(ident.name).width
        ctx.fillStyle = 'rgba(0,0,0,0.78)'
        ctx.fillRect(pt.x - tw / 2 - 6, pt.y - 30, tw + 12, 17)
        ctx.fillStyle = '#fff'
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'center'
        ctx.fillText(ident.name, pt.x, pt.y - 21)
        ctx.textAlign = 'left'
      }

      // ── camera markers + aim handles ───────────────────────────────────────
      camList.forEach((c, i) => {
        const p = camPx(c)
        const colour = CAM_COLOURS[i]
        const hx = p.x + Math.cos(c.angle) * HANDLE_LEN
        const hy = p.y + Math.sin(c.angle) * HANDLE_LEN
        // aim line + handle
        ctx.strokeStyle = colour
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(hx, hy); ctx.stroke()
        ctx.fillStyle = colour
        ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI * 2); ctx.fill()
        // body
        ctx.fillStyle = colour
        ctx.beginPath(); ctx.arc(p.x, p.y, CAM_R, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#0b0b0d'
        ctx.font = '700 13px sans-serif'
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'center'
        ctx.fillText(String(i + 1), p.x, p.y + 0.5)
        ctx.textAlign = 'left'
      })
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [analysisRef, presenceRef])

  // ── drag interaction ───────────────────────────────────────────────────────
  const pointerPos = (e: React.PointerEvent): Vec => {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const cv = canvasRef.current
    if (!cv) return
    const room = roomOf(cv.width, cv.height)
    const m = pointerPos(e)
    for (let i = 0; i < camsRef.current.length; i++) {
      const c = camsRef.current[i]
      const px = room.x + c.x * room.w, py = room.y + c.y * room.h
      const hx = px + Math.cos(c.angle) * HANDLE_LEN, hy = py + Math.sin(c.angle) * HANDLE_LEN
      if (Math.hypot(m.x - hx, m.y - hy) < 14) { dragRef.current = { cam: i, mode: 'aim' }; break }
      if (Math.hypot(m.x - px, m.y - py) < CAM_R + 4) { dragRef.current = { cam: i, mode: 'move' }; break }
    }
    if (dragRef.current) (e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    const cv = canvasRef.current
    if (!drag || !cv) return
    const room = roomOf(cv.width, cv.height)
    const m = pointerPos(e)
    setCams(prev => {
      const next = prev.map(c => ({ ...c }))
      const c = next[drag.cam]
      if (drag.mode === 'move') {
        c.x = clamp((m.x - room.x) / room.w, 0, 1)
        c.y = clamp((m.y - room.y) / room.h, 0, 1)
      } else {
        const px = room.x + c.x * room.w, py = room.y + c.y * room.h
        c.angle = Math.atan2(m.y - py, m.x - px)
      }
      return next
    })
  }

  const endDrag = () => {
    if (dragRef.current) { dragRef.current = null; saveCameras(camsRef.current) }
  }

  return (
    <div className="flex flex-col h-screen bg-surface-950 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 h-11 shrink-0 bg-surface-900 border-b border-surface-700">
        <button
          onClick={onExit}
          className="text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-white transition-colors"
        >
          ‹ Switcher
        </button>
        <span className="text-xs font-bold tracking-wider text-slate-200">STUDIO MAP</span>
        <span className="text-[10px] text-slate-600">
          Drag a camera to move it · drag its handle to aim
        </span>
        <button
          onClick={resetLayout}
          className="ml-auto text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-surface-700 text-slate-400 hover:text-white transition-colors"
        >
          Reset layout
        </button>
      </div>

      {/* Map */}
      <div className="flex-1 min-h-0 p-1">
        <div className="relative h-full bg-black rounded border border-surface-700 overflow-hidden">
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="w-full h-full touch-none"
          />
          <div className="absolute bottom-2 left-2 flex flex-col gap-0.5 pointer-events-none">
            <span className="text-[10px] text-slate-500">
              Sightlines show every detection — a filled dot is a face, a ring is
              a body (face turned away). A large named dot is a recognised
              presenter fixed by two or more cameras.
            </span>
            <span className="text-[10px] text-slate-700">
              Approximate — a layout aid, not a survey. Set camera roles &amp; names in the Direct tab.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
