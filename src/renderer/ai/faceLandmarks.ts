/**
 * Pure FaceLandmarker result → FaceBox conversion. Shared by the detection
 * Worker (detectionWorker.ts) and the main-thread fallback in
 * SceneAnalysisProvider, so both produce identical face data.
 */

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

interface LandmarkPoint { x: number; y: number }
interface LandmarkerResultLike {
  faceLandmarks?: LandmarkPoint[][]
  faceBlendshapes?: { categories?: { categoryName: string; score: number }[] }[]
}

/**
 * Convert a FaceLandmarker result into normalised face boxes. The box is
 * derived from the landmark-mesh extents (padded so it reads as a head); the
 * mesh itself is kept interleaved for the AI overlay, and `jawOpen` is lifted
 * out as the mouth-openness signal the speaker detector correlates to audio.
 */
export function resultToFaces(res: LandmarkerResultLike): FaceBox[] {
  const lms = res.faceLandmarks ?? []
  const blends = res.faceBlendshapes ?? []
  return lms.map((lm, k) => {
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
}
