import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { useCameraStreams } from '../camera/CameraStreamProvider'

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

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
  analysis: CameraAnalysis[]
  ready: boolean
}

const Ctx = createContext<SceneContextValue | null>(null)

/**
 * Per-camera face analysis — runs MediaPipe FaceLandmarker round-robin over the
 * four camera feeds. As well as face boxes (for AI tracking and the AI overlay)
 * it extracts mouth openness per face, which the AI Director correlates against
 * the audio to work out who is speaking.
 */
export function SceneAnalysisProvider({ children }: { children: ReactNode }) {
  const { videoEls } = useCameraStreams()
  const [analysis, setAnalysis] = useState<CameraAnalysis[]>(() => [
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
      setAnalysis(prev => {
        const next = prev.slice()
        next[idx] = { faces, people: faces.length, primary, updatedAt: Date.now() }
        return next
      })
    }

    const loop = () => {
      if (cancelled || !landmarker) return
      const v = videoEls.current[cam]
      if (v && v.readyState >= 2 && v.videoWidth > 0) {
        try {
          const res = landmarker.detect(v)
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
          updateCamera(cam, faces)
          if (!logged) {
            logged = true
            console.log(`[scene] analysis running — cam${cam}: ${faces.length} face(s)`)
          }
        } catch (e) {
          if (!logged) {
            logged = true
            console.warn('[scene] detect failed:', (e as Error).message)
          }
        }
      }
      cam = (cam + 1) % 4
      timer = setTimeout(loop, DETECT_INTERVAL_MS)
    }

    ;(async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE)
        landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'IMAGE',
          numFaces: 5,
          outputFaceBlendshapes: true,
        })
        if (cancelled) { landmarker.close(); return }
        console.log('[scene] face landmarker ready')
        setReady(true)
        loop()
      } catch (e) {
        console.error('[scene] face landmarker init failed:', (e as Error).message)
      }
    })()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      landmarker?.close()
    }
  }, [videoEls])

  return <Ctx.Provider value={{ analysis, ready }}>{children}</Ctx.Provider>
}

export function useSceneAnalysis() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSceneAnalysis must be used within SceneAnalysisProvider')
  return ctx
}
