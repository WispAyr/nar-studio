// Built-in grade "Looks" — one-click presets for the Colour view.
//
// Two kinds: numeric looks that just dial the lift/gamma/gain pipeline, and
// cinematic looks backed by a procedurally-generated 3D LUT (for tone curves
// and split-toning the numeric pipeline can't express). LUTs are cached and
// regenerated from a preset id on reload, so a chosen look survives a restart.

import { createNeutralGrade, type CubeLUT, type Grade } from './types'

const LUT_SIZE = 33

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
/** Blend x toward an S-shaped contrast curve. amt 0 = identity. */
const sCurve = (x: number, amt: number) => mix(x, x * x * (3 - 2 * x), amt)
/** Lift the shadow end without touching the highlights. */
const toe = (x: number, k: number) => x + k * (1 - x) * (1 - x)

type ColourFn = (r: number, g: number, b: number) => [number, number, number]

const lutCache = new Map<string, CubeLUT>()

/** Sample a colour transform over a cube to build a CubeLUT (cached by id). */
function buildCubeLUT(id: string, title: string, fn: ColourFn): CubeLUT {
  const cached = lutCache.get(id)
  if (cached) return cached
  const size = LUT_SIZE
  const m = size - 1
  const data = new Float32Array(size * size * size * 3)
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const [or, og, ob] = fn(r / m, g / m, b / m)
        const i = ((b * size + g) * size + r) * 3
        data[i] = clamp01(or)
        data[i + 1] = clamp01(og)
        data[i + 2] = clamp01(ob)
      }
    }
  }
  const lut: CubeLUT = {
    size,
    domainMin: { r: 0, g: 0, b: 0 },
    domainMax: { r: 1, g: 1, b: 1 },
    data,
    title,
  }
  lutCache.set(id, lut)
  return lut
}

// ── Cinematic colour transforms ─────────────────────────────────────────────

/** Gentle film S-curve, soft toe, faint warmth. */
const tFilmic: ColourFn = (r, g, b) => [
  toe(sCurve(r, 0.5), 0.022) * 1.03,
  toe(sCurve(g, 0.5), 0.022),
  toe(sCurve(b, 0.5), 0.022) * 0.985,
]

/** Teal shadows, orange highlights — the modern broadcast split-tone. */
const tTealOrange: ColourFn = (r, g, b) => {
  const L = lum(r, g, b)
  const sw = clamp01(1 - L * 2.0) * 0.16
  const hw = clamp01((L - 0.5) * 2.0) * 0.15
  let R = mix(r, 0.10, sw), G = mix(g, 0.50, sw), B = mix(b, 0.60, sw)
  R = mix(R, 1.00, hw); G = mix(G, 0.60, hw); B = mix(B, 0.22, hw)
  return [sCurve(R, 0.28), sCurve(G, 0.28), sCurve(B, 0.28)]
}

/** Bleach bypass — desaturated, high-contrast, faintly cool. */
const tBleach: ColourFn = (r, g, b) => {
  const L = lum(r, g, b)
  const R = sCurve(mix(r, L, 0.5), 0.62) * 0.99
  const G = sCurve(mix(g, L, 0.5), 0.62)
  const B = sCurve(mix(b, L, 0.5), 0.62) * 1.04
  return [R, G, B]
}

/** Vintage fade — lifted blacks, rolled-off highlights, warm amber cast. */
const tVintage: ColourFn = (r, g, b) => {
  const lift = 0.055
  let R = lift + r * (1 - lift), G = lift + g * (1 - lift), B = lift + b * (1 - lift)
  R *= 1 - 0.07 * R; G *= 1 - 0.07 * G; B *= 1 - 0.07 * B
  const L = lum(R, G, B)
  R = mix(R, L, 0.16) * 1.06
  G = mix(G, L, 0.16) * 1.01
  B = mix(B, L, 0.16) * 0.90
  return [R, G, B]
}

/** Noir — punchy monochrome with a touch of cool in the deep shadows. */
const tNoir: ColourFn = (r, g, b) => {
  const v = sCurve(lum(r, g, b), 0.5)
  const shadow = clamp01(1 - v * 1.5)
  return [v - shadow * 0.012, v, v + shadow * 0.03]
}

// ── Preset registry ─────────────────────────────────────────────────────────

export interface GradePreset {
  id: string
  label: string
  group: 'Studio' | 'Cinematic'
  /** Builds a fresh Grade — LUT looks attach a (cached) generated cube. */
  build: () => Grade
}

const numeric = (p: Partial<Grade>): Grade => ({ ...createNeutralGrade(), ...p })

const lutLook = (id: string, title: string, fn: ColourFn): Grade => ({
  ...createNeutralGrade(),
  lut: buildCubeLUT(id, title, fn),
  lutPresetId: id,
})

export const GRADE_PRESETS: GradePreset[] = [
  { id: 'neutral', label: 'Neutral', group: 'Studio', build: () => createNeutralGrade() },
  {
    id: 'bright', label: 'Bright & Clean', group: 'Studio',
    build: () => numeric({ gain: { r: 1.07, g: 1.07, b: 1.07 }, contrast: 1.07, saturation: 1.05 }),
  },
  {
    id: 'soft', label: 'Soft', group: 'Studio',
    build: () => numeric({ gamma: { r: 1.07, g: 1.07, b: 1.07 }, contrast: 0.9, saturation: 0.96 }),
  },
  { id: 'warm', label: 'Warm Studio', group: 'Studio', build: () => numeric({ temperature: 0.16 }) },
  { id: 'cool', label: 'Cool Daylight', group: 'Studio', build: () => numeric({ temperature: -0.16 }) },
  {
    id: 'punchy', label: 'Punchy', group: 'Studio',
    build: () => numeric({ contrast: 1.22, saturation: 1.2 }),
  },
  { id: 'filmic', label: 'Filmic', group: 'Cinematic', build: () => lutLook('filmic', 'Filmic', tFilmic) },
  {
    id: 'tealorange', label: 'Teal & Orange', group: 'Cinematic',
    build: () => lutLook('tealorange', 'Teal & Orange', tTealOrange),
  },
  {
    id: 'bleach', label: 'Bleach Bypass', group: 'Cinematic',
    build: () => lutLook('bleach', 'Bleach Bypass', tBleach),
  },
  {
    id: 'vintage', label: 'Vintage Fade', group: 'Cinematic',
    build: () => lutLook('vintage', 'Vintage Fade', tVintage),
  },
  { id: 'noir', label: 'Noir B&W', group: 'Cinematic', build: () => lutLook('noir', 'Noir B&W', tNoir) },
]

/** Regenerate just the LUT for a preset id — used to restore looks on reload. */
export function presetLut(id: string): CubeLUT | undefined {
  return GRADE_PRESETS.find(p => p.id === id)?.build().lut
}
