import {
  createContext, useCallback, useContext, useRef, useState,
  type ReactNode, type MutableRefObject,
} from 'react'
import { GradeEngine, type GradeSource } from './GradeEngine'
import { parseCubeLUT } from './parseCubeLUT'
import { presetLut } from './presets'
import { createNeutralGrade, type Grade } from './types'

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
    const g = gradesRef.current[camIndex]
    if (!g || isNeutralGrade(g)) return null
    return engineRef.current!.process(source, g)
  }, [])

  return (
    <Ctx.Provider value={{
      grades, gradesRef, setGrade, resetGrade, copyGradeToAll,
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
