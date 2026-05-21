/**
 * Pure PoseLandmarker result → PoseBox conversion. Shared by the detection
 * Worker and SceneAnalysisProvider, so both produce identical body data.
 *
 * Pose detection finds *people* — including ones whose face is turned away —
 * which the director uses so a camera with someone in it is never mistaken for
 * an empty chair, and which the studio map uses to place presenters.
 */

export interface PoseBox {
  /** Normalised 0..1 body bounding box within the camera frame. */
  x: number
  y: number
  w: number
  h: number
  /** Box centre, normalised. */
  cx: number
  cy: number
  /** Horizontal centre of the shoulder line, normalised (the body's bearing). */
  shoulderX: number
  /** Mean landmark visibility 0..1. */
  score: number
  /** The 33 pose landmarks — interleaved normalised x,y pairs. For the overlay. */
  landmarks: Float32Array
}

interface PosePoint { x: number; y: number; visibility?: number }
interface PoseResultLike { landmarks?: PosePoint[][] }

// MediaPipe Pose landmark indices for the shoulders.
const L_SHOULDER = 11
const R_SHOULDER = 12

/** Convert a PoseLandmarker result into normalised body boxes. */
export function resultToPoses(res: PoseResultLike): PoseBox[] {
  const poses = res.landmarks ?? []
  const out: PoseBox[] = []
  for (const lm of poses) {
    if (!lm.length) continue
    let minX = 1, minY = 1, maxX = 0, maxY = 0
    let visSum = 0, visN = 0
    const landmarks = new Float32Array(lm.length * 2)
    for (let p = 0; p < lm.length; p++) {
      const pt = lm[p]
      landmarks[p * 2] = pt.x
      landmarks[p * 2 + 1] = pt.y
      if (pt.x < minX) minX = pt.x
      if (pt.x > maxX) maxX = pt.x
      if (pt.y < minY) minY = pt.y
      if (pt.y > maxY) maxY = pt.y
      if (typeof pt.visibility === 'number') { visSum += pt.visibility; visN += 1 }
    }
    minX = Math.max(0, minX); minY = Math.max(0, minY)
    maxX = Math.min(1, maxX); maxY = Math.min(1, maxY)
    const w = maxX - minX, h = maxY - minY
    if (w <= 0.01 || h <= 0.01) continue
    const ls = lm[L_SHOULDER], rs = lm[R_SHOULDER]
    const shoulderX = ls && rs ? (ls.x + rs.x) / 2 : minX + w / 2
    out.push({
      x: minX, y: minY, w, h,
      cx: minX + w / 2, cy: minY + h / 2,
      shoulderX: Math.min(1, Math.max(0, shoulderX)),
      score: visN ? visSum / visN : 1,
      landmarks,
    })
  }
  return out
}
