import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from 'react'
import { ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision'
import { useViz, useVizActive } from '../viz/VizProvider'
import { localMediapipe, CDN_WASM, CDN_SEG_MODEL } from '../mediapipe'

// Re-run the model ~25fps; recomposite ~30fps (the capture rate). The matte is
// temporally smoothed to kill edge jitter, and the sharp presenter is laid
// over the background every composite so they stay crisp.
const MASK_REFRESH_MS = 40
const COMPOSITE_MS = 32
const MASK_EMA = 0.45   // weight kept from the previous matte — stabilises edges

export type BgMode = 'off' | 'blur' | 'colour' | 'viz'

export interface CameraBg {
  mode: BgMode
  /** Blur radius in px for `blur` mode. */
  blur: number
  /** Hex backdrop for `colour` mode. */
  colour: string
}

const DEFAULT_BG: CameraBg = { mode: 'off', blur: 18, colour: '#0a1a2f' }

interface SegContextValue {
  ready: boolean
  configs: CameraBg[]
  setConfig: (index: number, patch: Partial<CameraBg>) => void
  /**
   * Composite a camera frame's background (blur / colour / visualizer) behind
   * the segmented presenter. Returns the composited canvas, or null when the
   * camera's mode is off (the caller then draws the source unchanged).
   */
  segmentFrame: (camIndex: number, source: HTMLCanvasElement | HTMLVideoElement) => HTMLCanvasElement | null
}

const Ctx = createContext<SegContextValue | null>(null)

interface CamWork {
  out: HTMLCanvasElement
  fg: HTMLCanvasElement
  bg: HTMLCanvasElement
  mask: HTMLCanvasElement
  /** Temporally-smoothed matte confidence, at the model's mask resolution. */
  smooth: Float32Array | null
  w: number
  h: number
  lastMaskAt: number
  lastCompositeAt: number
}

interface MaskLike {
  width: number
  height: number
  getAsFloat32Array(): Float32Array
  close(): void
}

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function loadConfigs(): CameraBg[] {
  const out = [0, 1, 2, 3].map(() => ({ ...DEFAULT_BG }))
  try {
    const raw = localStorage.getItem('nar-segmentation')
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        for (let i = 0; i < 4; i++) {
          const s = arr[i]
          if (!s || typeof s !== 'object') continue
          if (s.mode === 'off' || s.mode === 'blur' || s.mode === 'colour' || s.mode === 'viz') {
            out[i].mode = s.mode
          }
          if (typeof s.blur === 'number') out[i].blur = s.blur
          if (typeof s.colour === 'string') out[i].colour = s.colour
        }
      }
    }
  } catch { /* corrupt store — fall back to defaults */ }
  return out
}

/**
 * Live background segmentation. Runs MediaPipe's real-time selfie segmenter to
 * separate the presenter from the background, so the compositor can blur it,
 * drop in a flat colour, or place the presenter over the live music
 * visualizer — a green-screen-free virtual set.
 */
export function SegmentationProvider({ children }: { children: ReactNode }) {
  const viz = useViz()
  const vizRef = useRef(viz)
  vizRef.current = viz

  const [ready, setReady] = useState(false)
  const [configs, setConfigs] = useState<CameraBg[]>(() => loadConfigs())
  const configsRef = useRef(configs)
  configsRef.current = configs

  // Keep the visualizer rendering whenever a camera uses it as a backdrop.
  useVizActive(configs.some(c => c.mode === 'viz'))

  const segmenterRef = useRef<ImageSegmenter | null>(null)
  const workRef = useRef<(CamWork | null)[]>([null, null, null, null])

  const setConfig = useCallback((index: number, patch: Partial<CameraBg>) => {
    setConfigs(prev => {
      const next = prev.slice()
      next[index] = { ...next[index], ...patch }
      try { localStorage.setItem('nar-segmentation', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    const createSegmenter = async (wasmBase: string, modelPath: string) => {
      const vision = await FilesetResolver.forVisionTasks(wasmBase)
      return ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelPath, delegate: 'GPU' },
        runningMode: 'IMAGE',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      })
    }
    ;(async () => {
      // Local bundled assets first (fast, offline); fall back to the CDN.
      let seg: ImageSegmenter | null = null
      try {
        seg = await createSegmenter(localMediapipe('wasm'), localMediapipe('selfie_segmenter.tflite'))
        if (cancelled) { seg.close(); return }
        console.log('[segmentation] selfie segmenter ready (local assets)')
      } catch (e) {
        if (cancelled) return
        console.warn('[segmentation] local assets unavailable — using CDN:', (e as Error).message)
        try {
          seg = await createSegmenter(CDN_WASM, CDN_SEG_MODEL)
          if (cancelled) { seg.close(); return }
          console.log('[segmentation] selfie segmenter ready (CDN)')
        } catch (e2) {
          console.error('[segmentation] init failed:', (e2 as Error).message)
          return
        }
      }
      segmenterRef.current = seg
      setReady(true)
    })()
    return () => {
      cancelled = true
      segmenterRef.current?.close()
      segmenterRef.current = null
    }
  }, [])

  const segmentFrame = useCallback((
    camIndex: number,
    source: HTMLCanvasElement | HTMLVideoElement,
  ): HTMLCanvasElement | null => {
    const seg = segmenterRef.current
    const cfg = configsRef.current[camIndex]
    if (!seg || !cfg || cfg.mode === 'off') return null
    const w = source instanceof HTMLVideoElement ? source.videoWidth : source.width
    const h = source instanceof HTMLVideoElement ? source.videoHeight : source.height
    if (w === 0 || h === 0) return null

    // Per-camera work canvases — created / resized as the source dictates.
    let work = workRef.current[camIndex]
    if (!work) {
      work = {
        out: newCanvas(w, h), fg: newCanvas(w, h), bg: newCanvas(w, h), mask: newCanvas(2, 2),
        smooth: null, w, h, lastMaskAt: 0, lastCompositeAt: 0,
      }
      workRef.current[camIndex] = work
    } else if (work.w !== w || work.h !== h) {
      for (const cv of [work.out, work.fg, work.bg]) { cv.width = w; cv.height = h }
      work.w = w; work.h = h
      work.lastMaskAt = 0
    }

    const now = performance.now()
    // Recomposite at ~30fps — return the cached frame in between.
    if (work.lastCompositeAt && now - work.lastCompositeAt < COMPOSITE_MS) return work.out
    work.lastCompositeAt = now

    // ── refresh the matte (and the blurred background) at ~25fps ─────────────
    if (now - work.lastMaskAt > MASK_REFRESH_MS) {
      work.lastMaskAt = now
      try {
        const result = seg.segment(source)
        const masks = result.confidenceMasks as MaskLike[] | undefined
        const m = masks && masks[0]
        if (m) {
          const mw = m.width, mh = m.height
          const raw = m.getAsFloat32Array()
          // Temporal EMA — blend with the previous matte to kill edge jitter.
          let smooth = work.smooth
          if (!smooth || smooth.length !== mw * mh) {
            smooth = new Float32Array(raw)
          } else {
            for (let i = 0; i < smooth.length; i++) {
              smooth[i] = smooth[i] * MASK_EMA + raw[i] * (1 - MASK_EMA)
            }
          }
          work.smooth = smooth
          if (work.mask.width !== mw) work.mask.width = mw
          if (work.mask.height !== mh) work.mask.height = mh
          const mc = work.mask.getContext('2d')!
          const id = mc.createImageData(mw, mh)
          for (let i = 0; i < mw * mh; i++) {
            const j = i * 4
            const a = smooth[i]
            id.data[j] = 255; id.data[j + 1] = 255; id.data[j + 2] = 255
            id.data[j + 3] = a < 0 ? 0 : a > 1 ? 255 : a * 255
          }
          mc.putImageData(id, 0, 0)
        }
        masks?.forEach(x => x.close())
        ;(result.categoryMask as MaskLike | undefined)?.close()
      } catch { /* a bad frame — keep the last matte */ }

      // The blurred backdrop is cached here; colour / viz are drawn live below.
      if (cfg.mode === 'blur') {
        const bgc = work.bg.getContext('2d')!
        bgc.globalCompositeOperation = 'source-over'
        bgc.filter = `blur(${cfg.blur}px)`
        bgc.clearRect(0, 0, w, h)
        bgc.drawImage(source, 0, 0, w, h)
        bgc.filter = 'none'
      }
    }

    // ── cut the sharp presenter out with a feathered matte ───────────────────
    const fgc = work.fg.getContext('2d')!
    fgc.globalCompositeOperation = 'source-over'
    fgc.filter = 'none'
    fgc.clearRect(0, 0, w, h)
    fgc.drawImage(source, 0, 0, w, h)
    fgc.globalCompositeOperation = 'destination-in'
    fgc.imageSmoothingEnabled = true
    fgc.filter = 'blur(2px)'   // feather the matte edge — softer, less fringe
    fgc.drawImage(work.mask, 0, 0, w, h)
    fgc.filter = 'none'
    fgc.globalCompositeOperation = 'source-over'

    // ── lay the presenter over the chosen background ─────────────────────────
    const oc = work.out.getContext('2d')!
    oc.globalCompositeOperation = 'source-over'
    oc.filter = 'none'
    oc.clearRect(0, 0, w, h)
    if (cfg.mode === 'blur') {
      oc.drawImage(work.bg, 0, 0, w, h)
    } else if (cfg.mode === 'viz') {
      const vc = vizRef.current.getCanvas()
      if (vc) oc.drawImage(vc, 0, 0, w, h)
      else { oc.fillStyle = '#000'; oc.fillRect(0, 0, w, h) }
    } else {
      oc.fillStyle = cfg.colour
      oc.fillRect(0, 0, w, h)
    }
    oc.drawImage(work.fg, 0, 0, w, h)
    return work.out
  }, [])

  return (
    <Ctx.Provider value={{ ready, configs, setConfig, segmentFrame }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSegmentation() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSegmentation must be used within SegmentationProvider')
  return ctx
}
