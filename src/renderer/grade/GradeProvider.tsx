import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode, type MutableRefObject,
} from 'react'
import { GradeEngine, type GradeSource } from './GradeEngine'
import { parseCubeLUT } from './parseCubeLUT'
import { presetLut } from './presets'
import { createNeutralGrade, type Grade, type RGB } from './types'
import { useCameraStreams } from '../camera/CameraStreamProvider'
import { useSceneAnalysis } from '../ai/SceneAnalysisProvider'

// Per-camera colour grades. The Colour view edits them; the compositor reads
// them to grade each camera as it draws the program output.
const STORAGE_KEY = 'nar-grades'
const CAM_COUNT = 4

/** True when a grade is an identity transform — lets the compositor skip it. */
export function isNeutralGrade(g: Grade): boolean {
  return (
    g.lift.r === 0 && g.lift.g === 0 && g.lift.b === 0 &&
    g.gamma.r === 1 && g.gamma.g === 1 && g.gamma.b === 1 &&
    g.gain.r === 1 && g.gain.g === 1 && g.gain.b === 1 &&
    g.contrast === 1 && g.saturation === 1 &&
    g.temperature === 0 && g.tint === 0 &&
    g.lut == null
  )
}

function cloneGrade(g: Grade): Grade {
  return {
    lift: { ...g.lift },
    gamma: { ...g.gamma },
    gain: { ...g.gain },
    contrast: g.contrast,
    saturation: g.saturation,
    temperature: g.temperature,
    tint: g.tint,
    lut: g.lut,
    lutPresetId: g.lutPresetId,
  }
}

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

function loadGrades(): Grade[] {
  const out = Array.from({ length: CAM_COUNT }, () => createNeutralGrade())
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return out
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return out
    for (let i = 0; i < CAM_COUNT; i++) {
      const s = arr[i]
      if (!s || typeof s !== 'object') continue
      const g = out[i]
      if (s.lift) { g.lift.r = num(s.lift.r, 0); g.lift.g = num(s.lift.g, 0); g.lift.b = num(s.lift.b, 0) }
      if (s.gamma) { g.gamma.r = num(s.gamma.r, 1); g.gamma.g = num(s.gamma.g, 1); g.gamma.b = num(s.gamma.b, 1) }
      if (s.gain) { g.gain.r = num(s.gain.r, 1); g.gain.g = num(s.gain.g, 1); g.gain.b = num(s.gain.b, 1) }
      g.contrast = num(s.contrast, 1)
      g.saturation = num(s.saturation, 1)
      g.temperature = num(s.temperature, 0)
      g.tint = num(s.tint, 0)
      // Preset LUTs aren't stored; regenerate them from the saved preset id.
      if (typeof s.lutPresetId === 'string') {
        const lut = presetLut(s.lutPresetId)
        if (lut) { g.lut = lut; g.lutPresetId = s.lutPresetId }
      }
    }
  } catch { /* corrupt store — fall back to neutral */ }
  return out
}

// LUTs are intentionally not persisted — a 65³ cube is far too large for
// localStorage. Numeric grade values are; LUTs are re-loaded each session.
function persist(grades: Grade[]): void {
  try {
    const slim = grades.map(g => ({
      lift: g.lift, gamma: g.gamma, gain: g.gain,
      contrast: g.contrast, saturation: g.saturation,
      temperature: g.temperature, tint: g.tint,
      lutPresetId: g.lutPresetId,
    }))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim))
  } catch { /* quota / disabled — non-fatal */ }
}

interface GradeContextValue {
  /** Per-camera grades, indexed 0..3. */
  grades: Grade[]
  /** Always-current grades — read by the compositor without re-rendering. */
  gradesRef: MutableRefObject<Grade[]>
  setGrade: (index: number, grade: Grade) => void
  resetGrade: (index: number) => void
  /** Copy one camera's grade onto all four — the camera-match shortcut. */
  copyGradeToAll: (index: number) => void
  /** Auto-match: continuously eases every camera's look toward a reference. */
  autoMatch: boolean
  setAutoMatch: (on: boolean) => void
  /** Reference camera index (0..3) the others are matched to. */
  matchReference: number
  setMatchReference: (i: number) => void
  /** A camera's manual grade combined with its live auto-match correction. */
  effectiveGrade: (index: number) => Grade
  /** Parse a .cube file and attach it as `index`'s LUT. Rejects on a bad file. */
  loadLut: (index: number, file: File) => Promise<void>
  clearLut: (index: number) => void
  /**
   * Grade one camera frame for the compositor. Returns the graded canvas, or
   * null when the camera's grade is neutral (caller should draw the raw frame).
   */
  gradeFrame: (camIndex: number, source: GradeSource) => HTMLCanvasElement | null
  /** True when the grade engine is GPU-accelerated (WebGL2). */
  accelerated: boolean
}

const Ctx = createContext<GradeContextValue | null>(null)

export function GradeProvider({ children }: { children: ReactNode }) {
  const [grades, setGrades] = useState<Grade[]>(() => loadGrades())
  const gradesRef = useRef(grades)
  gradesRef.current = grades

  // The compositor's grade engine — lives for the app's lifetime.
  const engineRef = useRef<GradeEngine | null>(null)
  if (!engineRef.current) engineRef.current = new GradeEngine()

  // ── Camera auto-match — keep all four cameras a consistent look ────────────
  const { videoEls } = useCameraStreams()
  const { analysisRef } = useSceneAnalysis()

  const [autoMatch, setAutoMatchState] = useState(() => localStorage.getItem('nar-auto-match') === 'on')
  const autoMatchRef = useRef(autoMatch)
  autoMatchRef.current = autoMatch
  const setAutoMatch = useCallback((on: boolean) => {
    localStorage.setItem('nar-auto-match', on ? 'on' : 'off')
    setAutoMatchState(on)
  }, [])

  const [matchReference, setMatchReferenceState] = useState(() => {
    const v = Number(localStorage.getItem('nar-match-ref'))
    return v >= 0 && v <= 3 ? v : 0
  })
  const matchReferenceRef = useRef(matchReference)
  matchReferenceRef.current = matchReference
  const setMatchReference = useCallback((i: number) => {
    localStorage.setItem('nar-match-ref', String(i))
    setMatchReferenceState(i)
  }, [])

  // Per-camera RGB gain correction owned by the auto-match loop (neutral 1,1,1).
  const matchGainRef = useRef<RGB[]>([
    { r: 1, g: 1, b: 1 }, { r: 1, g: 1, b: 1 }, { r: 1, g: 1, b: 1 }, { r: 1, g: 1, b: 1 },
  ])

  // The auto-match control loop — samples each camera (weighted toward any
  // detected face, since skin tone is what must stay consistent) and eases a
  // per-channel gain correction so every camera matches the reference. Slow and
  // clamped, so it never fights the operator or runs away.
  useEffect(() => {
    const work = document.createElement('canvas')
    work.width = 80
    work.height = 45
    const wctx = work.getContext('2d', { willReadFrequently: true })
    if (!wctx) return
    const EASE = 0.25
    const NEUTRAL: RGB = { r: 1, g: 1, b: 1 }

    const easeTo = (m: RGB, t: RGB) => {
      m.r += (t.r - m.r) * EASE
      m.g += (t.g - m.g) * EASE
      m.b += (t.b - m.b) * EASE
    }

    const sampleMean = (i: number): RGB | null => {
      const v = videoEls.current[i]
      if (!v || v.readyState < 2 || v.videoWidth === 0) return null
      try { wctx.drawImage(v, 0, 0, 80, 45) } catch { return null }
      let data: Uint8ClampedArray
      try { data = wctx.getImageData(0, 0, 80, 45).data } catch { return null }
      const meanRect = (x0: number, y0: number, x1: number, y1: number): RGB => {
        let r = 0, g = 0, b = 0, n = 0
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const p = (y * 80 + x) * 4
            r += data[p]; g += data[p + 1]; b += data[p + 2]; n++
          }
        }
        return n ? { r: r / n, g: g / n, b: b / n } : { r: 0, g: 0, b: 0 }
      }
      const whole = meanRect(0, 0, 80, 45)
      const face = analysisRef.current[i]?.primary
      if (face) {
        const half = Math.max(2, (face.size * 45) / 2)
        const x0 = Math.max(0, Math.round(face.cx * 80 - half))
        const x1 = Math.min(80, Math.round(face.cx * 80 + half))
        const y0 = Math.max(0, Math.round(face.cy * 45 - half))
        const y1 = Math.min(45, Math.round(face.cy * 45 + half))
        if (x1 - x0 > 2 && y1 - y0 > 2) {
          const skin = meanRect(x0, y0, x1, y1)
          return {
            r: whole.r * 0.35 + skin.r * 0.65,
            g: whole.g * 0.35 + skin.g * 0.65,
            b: whole.b * 0.35 + skin.b * 0.65,
          }
        }
      }
      return whole
    }

    const clampGain = (v: number) => Math.min(2.0, Math.max(0.5, v))

    const tick = () => {
      const gains = matchGainRef.current
      if (!autoMatchRef.current) {
        for (const m of gains) easeTo(m, NEUTRAL)   // off — ease back to neutral
        return
      }
      const ref = matchReferenceRef.current
      const refMean = sampleMean(ref)
      if (!refMean || refMean.r < 6 || refMean.g < 6 || refMean.b < 6) return
      const refGain = gradesRef.current[ref].gain
      for (let i = 0; i < 4; i++) {
        if (i === ref) { easeTo(gains[i], NEUTRAL); continue }
        const cm = sampleMean(i)
        if (!cm || cm.r < 6 || cm.g < 6 || cm.b < 6) continue
        const gi = gradesRef.current[i].gain
        easeTo(gains[i], {
          r: clampGain((refMean.r * refGain.r) / (cm.r * gi.r)),
          g: clampGain((refMean.g * refGain.g) / (cm.g * gi.g)),
          b: clampGain((refMean.b * refGain.b) / (cm.b * gi.b)),
        })
      }
    }
    const id = setInterval(tick, 1200)
    return () => clearInterval(id)
  }, [videoEls, analysisRef])

  /** A camera's manual grade combined with its live auto-match gain. */
  const effectiveGrade = useCallback((index: number): Grade => {
    const g = gradesRef.current[index]
    const m = matchGainRef.current[index]
    if (!m || (Math.abs(m.r - 1) < 0.002 && Math.abs(m.g - 1) < 0.002 && Math.abs(m.b - 1) < 0.002)) {
      return g
    }
    return {
      ...cloneGrade(g),
      gain: { r: g.gain.r * m.r, g: g.gain.g * m.g, b: g.gain.b * m.b },
    }
  }, [])

  const setGrade = useCallback((index: number, grade: Grade) => {
    setGrades(prev => {
      const next = prev.slice()
      next[index] = grade
      persist(next)
      return next
    })
  }, [])

  const resetGrade = useCallback((index: number) => {
    setGrade(index, createNeutralGrade())
  }, [setGrade])

  const copyGradeToAll = useCallback((index: number) => {
    setGrades(prev => {
      const next = prev.map(() => cloneGrade(prev[index]))
      persist(next)
      return next
    })
  }, [])

  const loadLut = useCallback(async (index: number, file: File) => {
    const text = await file.text()
    const lut = parseCubeLUT(text) // throws on a malformed file — caller catches
    setGrades(prev => {
      const next = prev.slice()
      // A hand-loaded .cube replaces any preset LUT — drop the preset id.
      next[index] = { ...cloneGrade(prev[index]), lut, lutPresetId: undefined }
      persist(next)
      return next
    })
  }, [])

  const clearLut = useCallback((index: number) => {
    setGrades(prev => {
      const next = prev.slice()
      const g = cloneGrade(prev[index])
      g.lut = undefined
      g.lutPresetId = undefined
      next[index] = g
      persist(next)
      return next
    })
  }, [])

  const gradeFrame = useCallback((camIndex: number, source: GradeSource) => {
    const eff = effectiveGrade(camIndex)
    if (!eff || isNeutralGrade(eff)) return null
    return engineRef.current!.process(source, eff)
  }, [effectiveGrade])

  return (
    <Ctx.Provider value={{
      grades, gradesRef, setGrade, resetGrade, copyGradeToAll,
      autoMatch, setAutoMatch, matchReference, setMatchReference, effectiveGrade,
      loadLut, clearLut, gradeFrame, accelerated: engineRef.current.isAccelerated,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useGrade() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useGrade must be used within GradeProvider')
  return ctx
}
