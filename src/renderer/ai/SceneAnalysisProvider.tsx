import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'
import { useCameraStreams } from '../camera/CameraStreamProvider'

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'

// One camera analysed per tick, round-robin across the four feeds.
const DETECT_INTERVAL_MS = 160

export interface FaceBox {
  /** Normalised 0..1 within the camera frame. */
  x: number
  y: number
  w: number
  h: number
  score: number
}

export interface CameraAnalysis {
  faces: FaceBox[]
  people: number
  /** The biggest face — the likely subject. Centre + size, normalised. */
  primary: { cx: number; cy: number; size: number } | null
  updatedAt: number
}

const emptyAnalysis = (): CameraAnalysis => ({ faces: [], people: 0, primary: null, updatedAt: 0 })

interface SceneContextValue {
  analysis: CameraAnalysis[]
  ready: boolean
}

const Ctx = createContext<SceneContextValue | null>(null)

/**
 * Per-camera person detection — runs MediaPipe FaceDetector round-robin over
 * the four camera feeds. Foundation for AI tracking and the AI Director.
 */
export function SceneAnalysisProvider({ children }: { children: ReactNode }) {
  const { videoEls } = useCameraStreams()
  const [analysis, setAnalysis] = useState<CameraAnalysis[]>(() => [
    emptyAnalysis(), emptyAnalysis(), emptyAnalysis(), emptyAnalysis(),
  ])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let detector: FaceDetector | null = null
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let cam = 0
    let logged = false

    const updateCamera = (idx: number, faces: FaceBox[]) => {
      let primary: CameraAnalysis['primary'] = null
      if (faces.length) {
        const big = faces.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a))
        primary = { cx: big.x + big.w / 2, cy: big.y + big.h / 2, size: Math.max(big.w, big.h) }
      }
      setAnalysis(prev => {
        const next = prev.slice()
        next[idx] = { faces, people: faces.length, primary, updatedAt: Date.now() }
        return next
      })
    }

    const loop = () => {
      if (cancelled || !detector) return
      const v = videoEls.current[cam]
      if (v && v.readyState >= 2 && v.videoWidth > 0) {
        try {
          const res = detector.detect(v)
          const faces: FaceBox[] = res.detections.map(d => {
            const bb = d.boundingBox!
            return {
              x: bb.originX / v.videoWidth,
              y: bb.originY / v.videoHeight,
              w: bb.width / v.videoWidth,
              h: bb.height / v.videoHeight,
              score: d.categories?.[0]?.score ?? 1,
            }
          })
          updateCamera(cam, faces)
          if (!logged) {
            logged = true
            console.log(`[scene] detection running — cam${cam}: ${faces.length} face(s)`)
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
        detector = await FaceDetector.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'IMAGE',
        })
        if (cancelled) { detector.close(); return }
        console.log('[scene] face detector ready')
        setReady(true)
        loop()
      } catch (e) {
        console.error('[scene] face detector init failed:', (e as Error).message)
      }
    })()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      detector?.close()
    }
  }, [videoEls])

  return <Ctx.Provider value={{ analysis, ready }}>{children}</Ctx.Provider>
}

export function useSceneAnalysis() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSceneAnalysis must be used within SceneAnalysisProvider')
  return ctx
}
