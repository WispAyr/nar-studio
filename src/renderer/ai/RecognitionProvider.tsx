import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode, type MutableRefObject,
} from 'react'
import { useCameraStreams } from '../camera/CameraStreamProvider'
import { useSceneAnalysis } from './SceneAnalysisProvider'
import { IdentityStore, type Identity } from './faceIdentity'
import { loadFaceRecognizer, describeFace } from './faceRecognizer'

// One camera recognised per tick — identity is stable, so this is plenty.
const TICK_MS = 240
const ALIGN_PX = 150         // aligned face crop size fed to the recognition net

// Per-camera face tracking — the cure for identity fragmentation. A face is
// tracked across ticks; its identity is decided ONCE, then sticky.
const ASSOC_DIST = 0.13      // normalised centroid distance to keep a track
const DROP_MISSING = 4       // recognition passes of no face before a track dies
const STABLE_HITS = 3        // a track must be this stable before it can mint an ID
const NEW_ID_PENDING = 3     // …and fail to match this many times first
const MATCH_DIST = 0.55      // descriptor distance to bind a track to an identity
const COVERAGE_RECENT_MS = 25_000  // "recently seen" window for off-camera alerts

// MediaPipe FaceLandmarker eye-corner indices — used to level + scale the face.
const EYE_L = 33
const EYE_R = 263

/** A recognised face on a camera — its centre and who it is. */
export interface PresenceEntry {
  cx: number
  cy: number
  identityId: string
  confidence: number
}

/** Which cameras currently show a given person. */
export interface CoverageInfo {
  identityId: string
  cameras: number[]
}

interface Track {
  cx: number
  cy: number
  identityId: string | null
  hits: number
  missing: number
  pending: number
}

interface RecognitionContextValue {
  ready: boolean
  /** The people discovered this session. */
  identities: Identity[]
  /** Per-person camera coverage — drives the off-camera alerts. */
  coverage: CoverageInfo[]
  /** Per-camera recognised faces — read in render loops without re-rendering. */
  presenceRef: MutableRefObject<PresenceEntry[][]>
  rename: (id: string, name: string) => void
  merge: (fromId: string, intoId: string) => void
  remove: (id: string) => void
}

const Ctx = createContext<RecognitionContextValue | null>(null)

/**
 * Cross-camera face recognition. Each camera's faces are tracked frame-to-
 * frame; a track's identity is decided once — matched against the session
 * identity store with a real face-recognition model — and then stays sticky.
 * Faces are levelled and scaled with the MediaPipe eye landmarks before the
 * recognition net, which is what makes the descriptors consistent.
 */
export function RecognitionProvider({ children }: { children: ReactNode }) {
  const { videoEls } = useCameraStreams()
  const { analysis } = useSceneAnalysis()
  const analysisRef = useRef(analysis)
  analysisRef.current = analysis

  const storeRef = useRef<IdentityStore | null>(null)
  if (!storeRef.current) storeRef.current = new IdentityStore()
  const tracksRef = useRef<Track[][]>([[], [], [], []])
  const presenceRef = useRef<PresenceEntry[][]>([[], [], [], []])

  const [ready, setReady] = useState(false)
  const [identities, setIdentities] = useState<Identity[]>([])
  const [coverage, setCoverage] = useState<CoverageInfo[]>([])

  const publish = useCallback(() => setIdentities(storeRef.current!.list()), [])

  const rename = useCallback((id: string, name: string) => {
    storeRef.current!.rename(id, name)
    publish()
  }, [publish])

  const merge = useCallback((fromId: string, intoId: string) => {
    storeRef.current!.merge(fromId, intoId)
    for (const camTracks of tracksRef.current) {
      for (const t of camTracks) if (t.identityId === fromId) t.identityId = intoId
    }
    publish()
  }, [publish])

  const remove = useCallback((id: string) => {
    storeRef.current!.remove(id)
    for (const camTracks of tracksRef.current) {
      for (const t of camTracks) {
        if (t.identityId === id) { t.identityId = null; t.pending = 0 }
      }
    }
    publish()
  }, [publish])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let cam = 0

    const aligned = document.createElement('canvas')
    aligned.width = ALIGN_PX
    aligned.height = ALIGN_PX
    const actx = aligned.getContext('2d')!

    /**
     * Align a detected face into the work canvas and return its descriptor.
     * Uses the eye landmarks to level and scale the face; falls back to a
     * plain square crop if landmarks are unavailable.
     */
    const describe = async (
      v: HTMLVideoElement,
      f: { x: number; y: number; w: number; h: number; landmarks?: Float32Array },
    ): Promise<Float32Array | null> => {
      const vw = v.videoWidth, vh = v.videoHeight
      const lm = f.landmarks
      actx.setTransform(1, 0, 0, 1, 0, 0)
      actx.clearRect(0, 0, ALIGN_PX, ALIGN_PX)

      let ok = false
      if (lm && lm.length >= (EYE_R + 1) * 2) {
        const e1x = lm[EYE_L * 2] * vw, e1y = lm[EYE_L * 2 + 1] * vh
        const e2x = lm[EYE_R * 2] * vw, e2y = lm[EYE_R * 2 + 1] * vh
        const dx = e2x - e1x, dy = e2y - e1y
        const eyeDist = Math.hypot(dx, dy)
        if (eyeDist >= 8) {
          actx.translate(ALIGN_PX / 2, ALIGN_PX * 0.42)
          actx.rotate(-Math.atan2(dy, dx))
          const scale = (ALIGN_PX * 0.46) / eyeDist
          actx.scale(scale, scale)
          actx.translate(-(e1x + e2x) / 2, -(e1y + e2y) / 2)
          try { actx.drawImage(v, 0, 0); ok = true } catch { ok = false }
        }
      }
      if (!ok) {
        const fcx = (f.x + f.w / 2) * vw, fcy = (f.y + f.h / 2) * vh
        const c = Math.min(Math.max(f.w * vw, f.h * vh) * 1.4, vw, vh)
        if (c < 16) return null
        const sx = Math.max(0, Math.min(fcx - c / 2, vw - c))
        const sy = Math.max(0, Math.min(fcy - c / 2, vh - c))
        actx.setTransform(1, 0, 0, 1, 0, 0)
        try { actx.drawImage(v, sx, sy, c, c, 0, 0, ALIGN_PX, ALIGN_PX) } catch { return null }
      }
      actx.setTransform(1, 0, 0, 1, 0, 0)
      return describeFace(aligned)
    }

    const processCamera = async () => {
      const store = storeRef.current!
      const now = Date.now()
      const v = videoEls.current[cam]
      const a = analysisRef.current[cam]
      const camTracks = tracksRef.current[cam]
      const used = new Set<Track>()

      if (v && v.readyState >= 2 && v.videoWidth > 0 && a) {
        for (const f of a.faces) {
          const fcx = f.x + f.w / 2
          const fcy = f.y + f.h / 2

          // Associate this face with the nearest existing track.
          let track: Track | null = null
          let bestD = ASSOC_DIST
          for (const t of camTracks) {
            if (used.has(t)) continue
            const d = Math.hypot(t.cx - fcx, t.cy - fcy)
            if (d < bestD) { bestD = d; track = t }
          }
          if (!track) {
            track = { cx: fcx, cy: fcy, identityId: null, hits: 0, missing: 0, pending: 0 }
            camTracks.push(track)
          }
          used.add(track)
          track.cx = fcx
          track.cy = fcy
          track.missing = 0
          track.hits += 1

          const desc = await describe(v, f)
          if (!desc) continue

          if (track.identityId) {
            // Identity is settled — just keep the person's descriptors fresh.
            store.reinforce(track.identityId, desc, now)
          } else {
            const best = store.findBest(desc)
            if (best && best.distance <= MATCH_DIST) {
              track.identityId = best.id
              store.reinforce(best.id, desc, now)
            } else {
              track.pending += 1
              // Only mint a new person once a track has proven stable — a
              // glitchy one-off detection must never create an identity.
              if (track.hits >= STABLE_HITS && track.pending >= NEW_ID_PENDING) {
                track.identityId = store.create(desc, now) ?? best?.id ?? null
              }
            }
          }
        }
      }

      // Age out tracks that did not match a face this pass.
      for (const t of camTracks) if (!used.has(t)) t.missing += 1
      tracksRef.current[cam] = camTracks.filter(t => t.missing <= DROP_MISSING)

      presenceRef.current[cam] = tracksRef.current[cam]
        .filter(t => t.identityId && t.missing === 0)
        .map(t => ({ cx: t.cx, cy: t.cy, identityId: t.identityId!, confidence: 1 }))

      // Coverage — which cameras currently show each known person.
      const cov = new Map<string, number[]>()
      for (let c = 0; c < 4; c++) {
        for (const t of tracksRef.current[c]) {
          if (t.identityId && t.missing === 0) {
            const arr = cov.get(t.identityId) ?? []
            if (!arr.includes(c)) arr.push(c)
            cov.set(t.identityId, arr)
          }
        }
      }
      setCoverage(store.list().map(i => ({ identityId: i.id, cameras: cov.get(i.id) ?? [] })))
      setIdentities(store.list())

      cam = (cam + 1) % 4
    }

    const loop = async () => {
      if (cancelled) return
      try { await processCamera() } catch (e) {
        console.warn('[recognition] tick failed:', (e as Error).message)
      }
      if (!cancelled) timer = setTimeout(loop, TICK_MS)
    }

    loadFaceRecognizer()
      .then(() => {
        if (cancelled) return
        console.log('[recognition] face-recognition model ready')
        setReady(true)
        loop()
      })
      .catch(e => console.error('[recognition] model init failed:', (e as Error).message))

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [videoEls])

  return (
    <Ctx.Provider value={{ ready, identities, coverage, presenceRef, rename, merge, remove }}>
      {children}
    </Ctx.Provider>
  )
}

export function useRecognition() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useRecognition must be used within RecognitionProvider')
  return ctx
}

export { COVERAGE_RECENT_MS }
