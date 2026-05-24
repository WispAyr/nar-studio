import { useEffect, useRef, useState } from 'react'
import { useSceneAnalysis } from '../../ai/SceneAnalysisProvider'
import { useRecognition } from '../../ai/RecognitionProvider'

/**
 * Studio map — a top-down schematic of the studio. The operator drags the four
 * cameras to match the real room and aims each one; the map then draws each
 * camera's field of view, a sightline to every detected person, and a solid
 * named dot where a recognised presenter is triangulated by two or more
 * cameras. Named zones (presenter / co-host / guest / producer / custom) mark
 * where people should be, and light up when someone is standing in them.
 *
 * It is deliberately an *approximate* operator aid: positions come from the
 * operator's layout plus where people sit in each frame — not survey-grade
 * measurement. It needs no camera calibration and no PTZ readback.
 */

interface CamPlacement {
  /** Position in the room, normalised 0..1. */
  x: number
  y: number
  /** Direction the camera looks, radians (screen space, 0 = +x). */
  angle: number
}

interface Zone {
  id: string
  label: string
  /** Centre in the room, normalised 0..1. */
  x: number
  y: number
  /** Radius, normalised to the room's shorter side. */
  r: number
  color: string
}

// OBSBot Tiny 2 horizontal field of view (wide), ~77°.
const FOV = 1.34
const HANDLE_LEN = 52   // px from camera body to its aim handle
const CAM_R = 15        // px camera body radius
const TAU = Math.PI * 2

const DEFAULT_CAMERAS: CamPlacement[] = [
  { x: 0.30, y: 0.06, angle: Math.PI / 2 },
  { x: 0.70, y: 0.06, angle: Math.PI / 2 },
  { x: 0.06, y: 0.62, angle: 0 },
  { x: 0.94, y: 0.62, angle: Math.PI },
]

const CAM_COLOURS = ['#e5202b', '#f7931e', '#22c55e', '#5b8dff']
const ZONE_PALETTE = ['#e5202b', '#7c5cff', '#22c55e', '#f7931e', '#06b6d4', '#ec4899', '#84cc16', '#64748b']

const DEFAULT_ZONES: Zone[] = [
  { id: 'presenter', label: 'Presenter', x: 0.50, y: 0.40, r: 0.11, color: '#e5202b' },
  { id: 'cohost', label: 'Co-host', x: 0.28, y: 0.56, r: 0.10, color: '#7c5cff' },
  { id: 'guest', label: 'Guest', x: 0.72, y: 0.56, r: 0.10, color: '#22c55e' },
  { id: 'producer', label: 'Producer', x: 0.50, y: 0.84, r: 0.09, color: '#64748b' },
]

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

function loadZones(): Zone[] {
  try {
    const raw = localStorage.getItem('nar-studio-zones')
    if (raw) {
      const a = JSON.parse(raw)
      if (Array.isArray(a)) {
        const zones = a
          .filter(z => z && typeof z.id === 'string')
          .map(z => ({
            id: z.id,
            label: typeof z.label === 'string' ? z.label : 'Zone',
            x: typeof z.x === 'number' ? z.x : 0.5,
            y: typeof z.y === 'number' ? z.y : 0.5,
            r: typeof z.r === 'number' ? z.r : 0.1,
            color: typeof z.color === 'string' ? z.color : ZONE_PALETTE[0],
          }))
        return zones
      }
    }
  } catch { /* fall through to defaults */ }
  return DEFAULT_ZONES.map(z => ({ ...z }))
}

function saveZones(z: Zone[]): void {
  try { localStorage.setItem('nar-studio-zones', JSON.stringify(z)) } catch { /* ignore */ }
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

type Drag =
  | { target: 'cam'; index: number; mode: 'move' | 'aim' }
  | { target: 'zone'; index: number; mode: 'move' | 'resize' }

interface Person { x: number; y: number; name: string; color: string }

export function StudioView({ onExit }: { onExit: () => void }) {
  const { analysisRef } = useSceneAnalysis()
  const { presenceRef, identities } = useRecognition()
  const [cams, setCams] = useState<CamPlacement[]>(loadCameras)
  const [zones, setZones] = useState<Zone[]>(loadZones)
  const camsRef = useRef(cams)
  camsRef.current = cams
  const zonesRef = useRef(zones)
  zonesRef.current = zones
  const identsRef = useRef(identities)
  identsRef.current = identities
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<Drag | null>(null)

  const resetLayout = () => {
    const d = DEFAULT_CAMERAS.map(c => ({ ...c }))
    setCams(d)
    saveCameras(d)
  }

  const patchZone = (id: string, patch: Partial<Zone>) => {
    setZones(prev => {
      const next = prev.map(z => (z.id === id ? { ...z, ...patch } : z))
      saveZones(next)
      return next
    })
  }
  const addZone = () => {
    setZones(prev => {
      const next = [...prev, {
        id: crypto.randomUUID(),
        label: 'New zone',
        x: 0.5, y: 0.5, r: 0.09,
        color: ZONE_PALETTE[prev.length % ZONE_PALETTE.length],
      }]
      saveZones(next)
      return next
    })
  }
  const removeZone = (id: string) => {
    setZones(prev => {
      const next = prev.filter(z => z.id !== id)
      saveZones(next)
      return next
    })
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
      const roomMin = Math.min(room.w, room.h)
      const diag = Math.hypot(room.w, room.h)
      const camPx = (c: CamPlacement): Vec => ({
        x: room.x + c.x * room.w,
        y: room.y + c.y * room.h,
      })
      const camList = camsRef.current
      const zoneList = zonesRef.current

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

      // ── triangulate recognised people (used for zone occupancy + dots) ─────
      const people: Person[] = []
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
        if (pt) people.push({ x: pt.x, y: pt.y, name: ident.name, color: ident.color })
      }

      // ── zones — named positions that light up when someone stands in them ──
      ctx.textAlign = 'center'
      for (const z of zoneList) {
        const zx = room.x + z.x * room.w
        const zy = room.y + z.y * room.h
        const rPx = Math.max(12, z.r * roomMin)
        const occ = people.filter(p => Math.hypot(p.x - zx, p.y - zy) <= rPx)
        ctx.fillStyle = z.color + (occ.length ? '33' : '18')
        ctx.beginPath(); ctx.arc(zx, zy, rPx, 0, TAU); ctx.fill()
        ctx.strokeStyle = z.color + (occ.length ? 'ff' : '88')
        ctx.lineWidth = occ.length ? 2.5 : 1.5
        ctx.setLineDash([6, 5])
        ctx.beginPath(); ctx.arc(zx, zy, rPx, 0, TAU); ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = z.color
        ctx.font = '700 11px sans-serif'
        ctx.textBaseline = 'alphabetic'
        ctx.fillText(z.label.toUpperCase(), zx, zy - rPx - 8)
        if (occ.length) {
          ctx.fillStyle = '#fff'
          ctx.font = '600 10px sans-serif'
          ctx.fillText(occ.map(o => o.name).join(', '), zx, zy + rPx + 14)
        }
        // resize handle, on the ring's right edge
        ctx.fillStyle = z.color
        ctx.beginPath(); ctx.arc(zx + rPx, zy, 5, 0, TAU); ctx.fill()
      }
      ctx.textAlign = 'left'

      // ── camera field-of-view cones ─────────────────────────────────────────
      camList.forEach((c, i) => {
        const p = camPx(c)
        const len = diag * 0.62
        const colour = CAM_COLOURS[i]
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.arc(p.x, p.y, len, c.angle - FOV / 2, c.angle + FOV / 2)
        ctx.closePath()
        ctx.fillStyle = colour + '12'
        ctx.fill()
        ctx.strokeStyle = colour + '3a'
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
            ctx.beginPath(); ctx.arc(ex, ey, 4.5, 0, TAU); ctx.fill()
          } else {
            ctx.strokeStyle = colour + 'cc'
            ctx.lineWidth = 2
            ctx.beginPath(); ctx.arc(ex, ey, 5, 0, TAU); ctx.stroke()
          }
        }
      })

      // ── camera markers + aim handles ───────────────────────────────────────
      camList.forEach((c, i) => {
        const p = camPx(c)
        const colour = CAM_COLOURS[i]
        const hx = p.x + Math.cos(c.angle) * HANDLE_LEN
        const hy = p.y + Math.sin(c.angle) * HANDLE_LEN
        ctx.strokeStyle = colour
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(hx, hy); ctx.stroke()
        ctx.fillStyle = colour
        ctx.beginPath(); ctx.arc(hx, hy, 6, 0, TAU); ctx.fill()
        ctx.beginPath(); ctx.arc(p.x, p.y, CAM_R, 0, TAU); ctx.fill()
        ctx.fillStyle = '#0b0b0d'
        ctx.font = '700 13px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(i + 1), p.x, p.y + 0.5)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
      })

      // ── confirmed people — recognised identities, drawn on top ─────────────
      for (const person of people) {
        ctx.fillStyle = person.color
        ctx.beginPath(); ctx.arc(person.x, person.y, 9, 0, TAU); ctx.fill()
        ctx.strokeStyle = '#0b0b0d'
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.font = '700 11px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const tw = ctx.measureText(person.name).width
        ctx.fillStyle = 'rgba(0,0,0,0.78)'
        ctx.fillRect(person.x - tw / 2 - 6, person.y - 30, tw + 12, 17)
        ctx.fillStyle = '#fff'
        ctx.fillText(person.name, person.x, person.y - 21)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
      }
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
    const roomMin = Math.min(room.w, room.h)
    const m = pointerPos(e)
    let hit: Drag | null = null
    // cameras first — small, precise targets
    for (let i = 0; i < camsRef.current.length && !hit; i++) {
      const c = camsRef.current[i]
      const px = room.x + c.x * room.w, py = room.y + c.y * room.h
      const hx = px + Math.cos(c.angle) * HANDLE_LEN, hy = py + Math.sin(c.angle) * HANDLE_LEN
      if (Math.hypot(m.x - hx, m.y - hy) < 14) hit = { target: 'cam', index: i, mode: 'aim' }
      else if (Math.hypot(m.x - px, m.y - py) < CAM_R + 4) hit = { target: 'cam', index: i, mode: 'move' }
    }
    // then zones — resize handle, then body
    for (let i = 0; i < zonesRef.current.length && !hit; i++) {
      const z = zonesRef.current[i]
      const zx = room.x + z.x * room.w, zy = room.y + z.y * room.h
      const rPx = Math.max(12, z.r * roomMin)
      if (Math.hypot(m.x - (zx + rPx), m.y - zy) < 13) hit = { target: 'zone', index: i, mode: 'resize' }
      else if (Math.hypot(m.x - zx, m.y - zy) < rPx) hit = { target: 'zone', index: i, mode: 'move' }
    }
    dragRef.current = hit
    if (hit) (e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    const cv = canvasRef.current
    if (!drag || !cv) return
    const room = roomOf(cv.width, cv.height)
    const roomMin = Math.min(room.w, room.h)
    const m = pointerPos(e)
    if (drag.target === 'cam') {
      setCams(prev => {
        const next = prev.map(c => ({ ...c }))
        const c = next[drag.index]
        if (drag.mode === 'move') {
          c.x = clamp((m.x - room.x) / room.w, 0, 1)
          c.y = clamp((m.y - room.y) / room.h, 0, 1)
        } else {
          const px = room.x + c.x * room.w, py = room.y + c.y * room.h
          c.angle = Math.atan2(m.y - py, m.x - px)
        }
        return next
      })
    } else {
      setZones(prev => {
        const next = prev.map(z => ({ ...z }))
        const z = next[drag.index]
        if (!z) return prev
        if (drag.mode === 'move') {
          z.x = clamp((m.x - room.x) / room.w, 0, 1)
          z.y = clamp((m.y - room.y) / room.h, 0, 1)
        } else {
          const zx = room.x + z.x * room.w, zy = room.y + z.y * room.h
          z.r = clamp(Math.hypot(m.x - zx, m.y - zy) / roomMin, 0.03, 0.45)
        }
        return next
      })
    }
  }

  const endDrag = () => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (drag.target === 'cam') saveCameras(camsRef.current)
    else saveZones(zonesRef.current)
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
          Drag cameras &amp; zones to move · drag a handle to aim / resize
        </span>
        <button
          onClick={resetLayout}
          className="ml-auto text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-surface-700 text-slate-400 hover:text-white transition-colors"
        >
          Reset cameras
        </button>
      </div>

      {/* Body: map + zone panel */}
      <div className="flex flex-1 min-h-0 gap-1 p-1">
        <div className="flex-1 min-w-0 relative bg-black rounded border border-surface-700 overflow-hidden">
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
              a body. A large named dot is a recognised presenter fixed by two cameras.
            </span>
            <span className="text-[10px] text-slate-700">
              Approximate — a layout aid, not a survey. A zone lights up when someone stands in it.
            </span>
          </div>
        </div>

        {/* Zone panel */}
        <div className="w-64 shrink-0 bg-surface-900 rounded border border-surface-700 flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700 shrink-0">
            <span className="text-xs font-bold tracking-wider text-slate-300">ZONES</span>
            <button
              onClick={addZone}
              className="text-xs text-slate-500 hover:text-white transition-colors"
            >
              + Add
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
            {zones.length === 0 && (
              <span className="text-[10px] text-slate-600 p-1">
                No zones. Add one to mark a studio position.
              </span>
            )}
            {zones.map(z => (
              <div key={z.id} className="flex items-center gap-1.5 rounded bg-surface-800 px-1.5 py-1">
                <input
                  type="color"
                  value={z.color}
                  onChange={e => patchZone(z.id, { color: e.target.value })}
                  title="Zone colour"
                  className="w-5 h-5 shrink-0 rounded bg-transparent border-0 cursor-pointer p-0"
                />
                <input
                  value={z.label}
                  onChange={e => patchZone(z.id, { label: e.target.value })}
                  className="flex-1 min-w-0 bg-transparent text-[11px] text-slate-200 outline-none focus:text-white"
                />
                <button
                  onClick={() => removeZone(z.id)}
                  title="Delete this zone"
                  className="text-slate-600 hover:text-nar-red text-sm leading-none shrink-0 px-0.5"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="px-3 py-2 border-t border-surface-700 shrink-0">
            <span className="text-[10px] text-slate-700 leading-snug">
              Drag a zone on the map to move it; drag the dot on its edge to
              resize. A zone turns bright and names whoever is standing in it.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
