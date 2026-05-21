/**
 * Detection worker. Runs MediaPipe FaceLandmarker + PoseLandmarker off the
 * renderer thread: the main thread sends camera frames as transferable
 * ImageBitmaps, and the expensive (blocking) detect() calls run here so the UI
 * and compositor never stall.
 *
 * Protocol
 *   in   { type: 'init', localWasm, localFace, localPose, cdnWasm, cdnFace, cdnPose }
 *   out  { type: 'ready', delegate, pose } | { type: 'error', message }
 *   in   { type: 'detect', cam, bitmap }
 *   out  { type: 'result', cam, faces, poses }
 */
import { FaceLandmarker, PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { resultToFaces } from './faceLandmarks'
import { resultToPoses } from './poseLandmarks'

// `self` is typed as Window under the DOM lib — cast away so worker calls build.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null
  postMessage: (msg: unknown) => void
}

let faceLm: FaceLandmarker | null = null
let poseLm: PoseLandmarker | null = null

ctx.onmessage = async (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === 'init') {
    // ── face landmarker (required) — local then CDN, GPU then CPU ────────────
    let vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null
    let delegate: 'GPU' | 'CPU' = 'GPU'
    const faceAttempts: [string, string, boolean][] = [
      [msg.localWasm, msg.localFace, true],
      [msg.cdnWasm, msg.cdnFace, true],
      [msg.localWasm, msg.localFace, false],
      [msg.cdnWasm, msg.cdnFace, false],
    ]
    for (const [wasm, faceModel, gpu] of faceAttempts) {
      if (!wasm || !faceModel) continue
      try {
        vision = await FilesetResolver.forVisionTasks(wasm)
        faceLm = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: faceModel, delegate: gpu ? 'GPU' : 'CPU' },
          runningMode: 'IMAGE',
          numFaces: 5,
          outputFaceBlendshapes: true,
        })
        delegate = gpu ? 'GPU' : 'CPU'
        break
      } catch { faceLm = null; vision = null }
    }
    if (!faceLm || !vision) {
      ctx.postMessage({ type: 'error', message: 'FaceLandmarker init failed' })
      return
    }
    // ── pose landmarker (optional) — try every model + delegate combination ──
    const poseAttempts: [string, boolean][] = [
      [msg.localPose, true], [msg.cdnPose, true],
      [msg.localPose, false], [msg.cdnPose, false],
    ]
    for (const [poseModel, gpu] of poseAttempts) {
      if (!poseModel) continue
      try {
        poseLm = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: poseModel, delegate: gpu ? 'GPU' : 'CPU' },
          runningMode: 'IMAGE',
          numPoses: 3,
        })
        break
      } catch { poseLm = null }
    }
    ctx.postMessage({ type: 'ready', delegate, pose: !!poseLm })
    return
  }

  if (msg.type === 'detect') {
    const { cam, bitmap } = msg as { cam: number; bitmap: ImageBitmap }
    let faces: ReturnType<typeof resultToFaces> = []
    let poses: ReturnType<typeof resultToPoses> = []
    try {
      if (faceLm) faces = resultToFaces(faceLm.detect(bitmap))
    } catch { /* a bad frame — report no faces */ }
    try {
      if (poseLm) poses = resultToPoses(poseLm.detect(bitmap))
    } catch { /* a bad frame — report no poses */ }
    bitmap.close()
    ctx.postMessage({ type: 'result', cam, faces, poses })
  }
}
