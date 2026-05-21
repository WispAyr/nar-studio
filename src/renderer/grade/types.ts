// Colour-grading engine types. Self-contained — no imports outside src/renderer/grade/.

/** An RGB triplet, components typically in the 0..2 range for grade controls. */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * A parsed Adobe `.cube` 3D LUT, ready for upload as a WebGL2 TEXTURE_3D.
 * `data` is RGB float triplets in nearest-neighbour (b-major) order:
 * index = ((b * size) + g) * size + r, 3 floats per entry.
 */
export interface CubeLUT {
  /** Edge size of the cube (e.g. 17, 33, 65). */
  size: number;
  /** Per-channel domain minimum (defaults to {0,0,0}). */
  domainMin: RGB;
  /** Per-channel domain maximum (defaults to {1,1,1}). */
  domainMax: RGB;
  /** size*size*size*3 floats, RGB interleaved, R fastest then G then B. */
  data: Float32Array;
  /** Optional human-readable title from a TITLE line. */
  title?: string;
}

/**
 * A full colour grade. Neutral values produce an identity transform.
 *
 * Pipeline (per fragment):
 *   input
 *   -> lift/gamma/gain   out = pow(gain*(in+lift), 1/gamma)
 *   -> contrast          around a 0.5 pivot
 *   -> temperature/tint  warm/cool + green/magenta shift
 *   -> saturation        luma-preserving
 *   -> 3D LUT            trilinear, if present
 */
export interface Grade {
  /** Shadow offset per channel. Neutral 0. Range ~0..2 (commonly small). */
  lift: RGB;
  /** Midtone power per channel. Neutral 1. Range ~0..2. */
  gamma: RGB;
  /** Highlight multiplier per channel. Neutral 1. Range ~0..2. */
  gain: RGB;
  /** Global contrast around 0.5. Neutral 1. Range ~0..2. */
  contrast: number;
  /** Luma-preserving saturation. Neutral 1. Range ~0..2. */
  saturation: number;
  /** Warm (+) / cool (-) shift. Neutral 0. Range -1..1. */
  temperature: number;
  /** Magenta (+) / green (-) shift. Neutral 0. Range -1..1. */
  tint: number;
  /** Optional 3D LUT applied last. */
  lut?: CubeLUT;
  /** Set when the LUT came from a built-in preset — lets the look persist and reload. */
  lutPresetId?: string;
}

/** Identity / neutral grade — produces output identical to input (no LUT). */
export const NEUTRAL_GRADE: Grade = {
  lift: { r: 0, g: 0, b: 0 },
  gamma: { r: 1, g: 1, b: 1 },
  gain: { r: 1, g: 1, b: 1 },
  contrast: 1,
  saturation: 1,
  temperature: 0,
  tint: 0,
};

/** Returns a fresh deep copy of the neutral grade (safe to mutate). */
export function createNeutralGrade(): Grade {
  return {
    lift: { r: 0, g: 0, b: 0 },
    gamma: { r: 1, g: 1, b: 1 },
    gain: { r: 1, g: 1, b: 1 },
    contrast: 1,
    saturation: 1,
    temperature: 0,
    tint: 0,
  };
}
