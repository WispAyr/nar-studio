import {
  createContext, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode, type MutableRefObject,
} from 'react'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { useCameraStreams } from '../camera/CameraStreamProvider'
import { localMediapipe, CDN_WASM, CDN_FACE_MODEL, CDN_POSE_MODEL } from '../mediapipe'
import { resultToFaces, type FaceBox } from './faceLandmarks'
import { type PoseBox } from './poseLandmarks'

export type { FaceBox } from './faceLandmarks'
export type { PoseBox } from './poseLandmarks'

// One camera analysed per tick, round-robin across the four feeds.
const DETECT_INTERVAL_MS = 80

export interface CameraAnalysis {
  faces: FaceBox[]
  /** Detected bodies — finds people even when their face is turned away. */
  poses: PoseBox[]
  people: number
  /** The biggest face — the likely subject. Centre + size + mouth, normalised. */
  primary: { cx: number; cy: number; size: number; mouthOpen: number } | null
  updatedAt: number
}

const emptyAnalysis = (): CameraAnalysis =>
  ({ faces: [], poses: [], people: 0, primary: null, updatedAt: 0 })

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
 * Per-camera face analysis. MediaPipe FaceLandmarker runs round-robin over the
 * four camera feeds in a Web Worker — the expensive detect() is kept off the
 * renderer thread so the compositor and UI never stall. If the worker cannot
 * start it transparently falls back to detecting on the main thread.
 *
 * As well as face boxes (for AI tracking and the AI overlay) it extracts mouth
 * openness per face, which the AI Director correlates against the audio to work
 * out who is speaking. Results are published into a ref so the detection rate
 * costs nothing in React renders.
 */
export function SceneAnalysisProvider({ children }: { children: ReactNode }) {
  const { videoEls } = useCameraStreams()
  const analysisRef = useRef<CameraAnalysis[]>([
    emptyAnalysis(), emptyAnalysis(), emptyAnalysis(), emptyAnalysis(),
  ])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let cam = 0
    let logged = false
    let usingFallback = false
    const cleanups: Array<() => void> = []

    const updateCamera = (idx: number, faces: FaceBox[], poses: PoseBox[]) => {
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
      // `people` counts faces or bodies, so a person turned away still registers.
      analysisRef.current[idx] = {
        faces, poses,
        people: Math.max(faces.length, poses.length),
        primary,
        updatedAt: Date.now(),
      }
    }

    // The next camera (scanning from `cam`) with a live frame, or -1. Dead
    // slots are skipped at no cost, so live feeds get analysed more often.
    const nextLiveCam = (): number => {
      for (let n = 0; n < 4; n++) {
        const i = (cam + n) % 4
        const v = videoEls.current[i]
        if (v && v.readyState >= 2 && v.videoWidth > 0) { cam = (i + 1) % 4; return i }
      }
      return -1
    }

    const markRunning = (where: string, idx: number, n: number) => {
      if (logged) return
      logged = true
      console.log(`[scene] analysis running (${where}) — cam${idx}: ${n} face(s)`)
    }

    // ── main-thread fallback — used only if the worker cannot start ──────────
    const runOnMainThread = () => {
      if (cancelled) return
      let landmarker: FaceLandmarker | null = null
      let timer: ReturnType<typeof setTimeout> | null = null
      cleanups.push(() => { if (timer) clearTimeout(timer); landmarker?.close() })

      const createLandmarker = async (wasmBase: string, modelPath: string) => {
        const vision = await FilesetResolver.forVisionTasks(wasmBase)
        return FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: modelPath, delegate: 'GPU' },
          runningMode: 'IMAGE',
          numFaces: 5,
          outputFaceBlendshapes: true,
        })
      }

      const loop = () => {
        if (cancelled || !landmarker) return
        const idx = nextLiveCam()
        if (idx >= 0) {
          const v = videoEls.current[idx]!
          try {
            // The main-thread fallback runs face-only (pose is worker-only, to
            // keep the fallback light) — passes empty poses.
            updateCamera(idx, resultToFaces(landmarker.detect(v)), [])
            markRunning('main thread', idx, analysisRef.current[idx].faces.length)
          } catch (e) {
            if (!logged) { logged = true; console.warn('[scene] detect failed:', (e as Error).message) }
          }
        }
        timer = setTimeout(loop, DETECT_INTERVAL_MS)
      }

      ;(async () => {
        try {
          landmarker = await createLandmarker(localMediapipe('wasm'), localMediapipe('face_landmarker.task'))
          if (cancelled) { landmarker.close(); return }
          console.log('[scene] face landmarker ready (main thread, local assets)')
        } catch {
          if (cancelled) return
          try {
            landmarker = await createLandmarker(CDN_WASM, CDN_FACE_MODEL)
            if (cancelled) { landmarker.close(); return }
            console.log('[scene] face landmarker ready (main thread, CDN)')
          } catch (e2) {
            console.error('[scene] face landmarker init failed:', (e2 as Error).message)
            return
          }
        }
        setReady(true)
        loop()
      })()
    }

    // ── worker path — detection runs off the renderer thread ────────────────
    const runWithWorker = (): boolean => {
      let worker: Worker
      try {
        worker = new Worker(new URL('./detectionWorker.ts', import.meta.url), { type: 'module' })
      } catch (e) {
        console.warn('[scene] detection worker unavailable:', (e as Error).message)
        return false
      }
      let workerReady = false
      let timer: ReturnType<typeof setTimeout> | null = null
      let initTimeout: ReturnType<typeof setTimeout> | null = null

      const fallback = (why: string) => {
        if (usingFallback || cancelled) return
        usingFallback = true
        console.warn('[scene] detection worker failed — using the main thread:', why)
        if (timer) clearTimeout(timer)
        if (initTimeout) clearTimeout(initTimeout)
        try { worker.terminate() } catch { /* ignore */ }
        runOnMainThread()
      }

      const schedule = () => { timer = setTimeout(tick, DETECT_INTERVAL_MS) }

      const tick = async () => {
        if (cancelled || usingFallback) return
        const idx = nextLiveCam()
        if (idx < 0) { schedule(); return }
        const v = videoEls.current[idx]!
        try {
          // Grab the frame as a transferable ImageBitmap (zero-copy hand-off).
          const bitmap = await createImageBitmap(v)
          if (cancelled || usingFallback) { bitmap.close(); return }
          worker.postMessage({ type: 'detect', cam: idx, bitmap }, [bitmap])
        } catch {
          schedule()   // frame grab failed — skip this camera, carry on
        }
      }

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data
        if (msg.type === 'ready') {
          workerReady = true
          if (initTimeout) clearTimeout(initTimeout)
          console.log(`[scene] detection worker ready (${msg.delegate}${msg.pose ? ' + pose' : ', face only'})`)
          setReady(true)
          tick()
        } else if (msg.type === 'error') {
          fallback(msg.message || 'worker reported an error')
        } else if (msg.type === 'result') {
          if (cancelled || usingFallback) return
          updateCamera(msg.cam, msg.faces, msg.poses ?? [])
          markRunning('worker', msg.cam, msg.faces.length)
          schedule()   // the next detection is paced from the result
        }
      }
      worker.onerror = () => fallback('worker crashed')

      worker.postMessage({
        type: 'init',
        localWasm: localMediapipe('wasm'),
        localFace: localMediapipe('face_landmarker.task'),
        localPose: localMediapipe('pose_landmarker.task'),
        cdnWasm: CDN_WASM,
        cdnFace: CDN_FACE_MODEL,
        cdnPose: CDN_POSE_MODEL,
      })
      // If the worker never reports ready, fall back rather than hang.
      initTimeout = setTimeout(() => { if (!workerReady) fallback('init timed out') }, 12000)

      cleanups.push(() => {
        if (timer) clearTimeout(timer)
        if (initTimeout) clearTimeout(initTimeout)
        try { worker.terminate() } catch { /* ignore */ }
      })
      return true
    }

    if (!runWithWorker()) runOnMainThread()

    return () => {
      cancelled = true
      cleanups.forEach(fn => fn())
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
