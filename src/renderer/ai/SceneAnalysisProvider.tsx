import {
  createContext, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode, type MutableRefObject,
} from 'react'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { useCameraStreams } from '../camera/CameraStreamProvider'
import { localMediapipe, CDN_WASM, CDN_FACE_MODEL } from '../mediapipe'

// One camera analysed per tick, round-robin across the four feeds.
const DETECT_INTERVAL_MS = 80

export interface FaceBox {
  /** Normalised 0..1 within the camera frame. */
  x: number
  y: number
  w: number
  h: number
  score: number
  /** Mouth openness 0..1 (MediaPipe `jawOpen` blendshape) — drives speaker detection. */
  mouthOpen: number
  /** The full landmark mesh — interleaved normalised x,y pairs. For the AI overlay. */
  landmarks: Float32Array
}

export interface CameraAnalysis {
  faces: FaceBox[]
  people: number
  /** The biggest face — the likely subject. Centre + size + mouth, normalised. */
  primary: { cx: number; cy: number; size: number; mouthOpen: number } | null
  updatedAt: number
}

const emptyAnalysis = (): CameraAnalysis => ({ faces: [], people: 0, primary: null, updatedAt: 0 })

interface SceneContextValue {
  /**
   * Live per-camera analysis. A ref — not state — so the ~12 Hz detection rate
   * never re-renders the provider tree. Read it inside render / rAF loops.
   */
  analysisRef: MutableRefObject<CameraAnalysis[]>
  ready: boolean
}

const Ctx = createContext<SceneContextValue | null>(null)

/**
 * Per-camera face analysis — runs MediaPipe FaceLandmarker round-robin over the
 * four camera feeds. As well as face boxes (for AI tracking and the AI overlay)
 * it extracts mouth openness per face, which the AI Director correlates against
 * the audio to work out who is speaking. Results are published into a ref so
 * the detection rate costs nothing in React renders.
 */
export function SceneAnalysisProvider({ children }: { children: ReactNode }) {
  const { videoEls } = useCameraStreams()
  const analysisRef = useRef<CameraAnalysis[]>([
    emptyAnalysis(), emptyAnalysis(), emptyAnalysis(), emptyAnalysis(),
  ])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let landmarker: FaceLandmarker | null = null
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let cam = 0
    let logged = false

    const updateCamera = (idx: number, faces: FaceBox[]) => {
      let primary: CameraAnalysis['primary'] = null
      if (faces.length) {
        const big = faces.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a))
        primary = {
          cx: big.x + big.w / 2,
          cy: big.y + big.h / 2,
          size: Math.max(big.w, big.h),
          mouthOpen: big.mouthOpen,
        }
      }
      // Mutate the ref in place — no setState, so no provider-tree re-render.
      analysisRef.current[idx] = { faces, people: faces.length, primary, updatedAt: Date.now() }
    }

    const detect = (idx: number, v: HTMLVideoElement) => {
      try {
        const res = landmarker!.detect(v)
        const lms = res.faceLandmarks ?? []
        const blends = res.faceBlendshapes ?? []
        const faces: FaceBox[] = lms.map((lm, k) => {
          // Derive a face box from the landmark mesh extents, and keep the
          // mesh itself (interleaved x,y) for the AI overlay to draw.
          let minX = 1, minY = 1, maxX = 0, maxY = 0
          const landmarks = new Float32Array(lm.length * 2)
          for (let p = 0; p < lm.length; p++) {
            const lx = lm[p].x, ly = lm[p].y
            landmarks[p * 2] = lx
            landmarks[p * 2 + 1] = ly
            if (lx < minX) minX = lx
            if (lx > maxX) maxX = lx
            if (ly < minY) minY = ly
            if (ly > maxY) maxY = ly
          }
          // Pad so the box reads as a head, not a tight feature mesh.
          const padX = (maxX - minX) * 0.08
          const padY = (maxY - minY) * 0.14
          minX = Math.max(0, minX - padX); maxX = Math.min(1, maxX + padX)
          minY = Math.max(0, minY - padY); maxY = Math.min(1, maxY + padY)
          const jaw = blends[k]?.categories?.find(c => c.categoryName === 'jawOpen')?.score ?? 0
          return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, score: 1, mouthOpen: jaw, landmarks }
        })
        updateCamera(idx, faces)
        if (!logged) {
          logged = true
          console.log(`[scene] analysis running — cam${idx}: ${faces.length} face(s)`)
        }
      } catch (e) {
        if (!logged) {
          logged = true
          console.warn('[scene] detect failed:', (e as Error).message)
        }
      }
    }

    const loop = () => {
      if (cancelled || !landmarker) return
      // Skip cameras with no live frame at no cost, so the feeds that ARE live
      // get analysed proportionally more often (better tracking, same budget).
      let scanned = 0
      while (scanned < 4) {
        const v = videoEls.current[cam]
        if (v && v.readyState >= 2 && v.videoWidth > 0) {
          detect(cam, v)
          cam = (cam + 1) % 4
          timer = setTimeout(loop, DETECT_INTERVAL_MS)
          return
        }
        cam = (cam + 1) % 4
        scanned++
      }
      // No camera has a live frame — check back at the normal interval.
      timer = setTimeout(loop, DETECT_INTERVAL_MS)
    }

    const createLandmarker = async (wasmBase: string, modelPath: string) => {
      const vision = await FilesetResolver.forVisionTasks(wasmBase)
      return FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelPath, delegate: 'GPU' },
        runningMode: 'IMAGE',
        numFaces: 5,
        outputFaceBlendshapes: true,
      })
    }

    ;(async () => {
      // Local bundled assets first (fast, offline); fall back to the CDN.
      try {
        landmarker = await createLandmarker(localMediapipe('wasm'), localMediapipe('face_landmarker.task'))
        if (cancelled) { landmarker.close(); return }
        console.log('[scene] face landmarker ready (local assets)')
      } catch (e) {
        if (cancelled) return
        console.warn('[scene] local assets unavailable — using CDN:', (e as Error).message)
        try {
          landmarker = await createLandmarker(CDN_WASM, CDN_FACE_MODEL)
          if (cancelled) { landmarker.close(); return }
          console.log('[scene] face landmarker ready (CDN)')
        } catch (e2) {
          console.error('[scene] face landmarker init failed:', (e2 as Error).message)
          return
        }
      }
      setReady(true)
      loop()
    })()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      landmarker?.close()
    }
  }, [videoEls])

  const value = useMemo(() => ({ analysisRef, ready }), [ready])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSceneAnalysis() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSceneAnalysis must be used within SceneAnalysisProvider')
  return ctx
}

/**
 * A polled snapshot of the per-camera analysis, for UI that needs to *render*
 * it. The core providers read `analysisRef` directly and never re-render; only
 * components that actually display the numbers use this, at a gentle cadence.
 */
export function useAnalysisSnapshot(periodMs = 400): CameraAnalysis[] {
  const { analysisRef } = useSceneAnalysis()
  const [snap, setSnap] = useState<CameraAnalysis[]>(() => analysisRef.current.slice())
  useEffect(() => {
    const id = setInterval(() => setSnap(analysisRef.current.slice()), periodMs)
    return () => clearInterval(id)
  }, [analysisRef, periodMs])
  return snap
}
