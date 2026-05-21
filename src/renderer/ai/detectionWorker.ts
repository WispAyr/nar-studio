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

async function initModels(wasmBase: string, faceModel: string, poseModel: string, gpu: boolean) {
  const vision = await FilesetResolver.forVisionTasks(wasmBase)
  const face = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: faceModel, delegate: gpu ? 'GPU' : 'CPU' },
    runningMode: 'IMAGE',
    numFaces: 5,
    outputFaceBlendshapes: true,
  })
  // Pose is optional — the face landmarker is the critical detector. If the
  // pose model is missing the worker still runs face-only.
  let pose: PoseLandmarker | null = null
  try {
    if (poseModel) {
      pose = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: poseModel, delegate: gpu ? 'GPU' : 'CPU' },
        runningMode: 'IMAGE',
        numPoses: 3,
      })
    }
  } catch { pose = null }
  return { face, pose }
}

ctx.onmessage = async (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === 'init') {
    // Local assets first, then CDN; GPU delegate first, then CPU. First that
    // loads wins — the renderer always gets a working detector if one exists.
    const attempts: [string, string, string, boolean][] = [
      [msg.localWasm, msg.localFace, msg.localPose, true],
      [msg.cdnWasm, msg.cdnFace, msg.cdnPose, true],
      [msg.localWasm, msg.localFace, msg.localPose, false],
      [msg.cdnWasm, msg.cdnFace, msg.cdnPose, false],
    ]
    for (const [wasm, faceModel, poseModel, gpu] of attempts) {
      if (!wasm || !faceModel) continue
      try {
        const { face, pose } = await initModels(wasm, faceModel, poseModel, gpu)
        faceLm = face
        poseLm = pose
        ctx.postMessage({ type: 'ready', delegate: gpu ? 'GPU' : 'CPU', pose: !!pose })
        return
      } catch { /* try the next source / delegate */ }
    }
    ctx.postMessage({ type: 'error', message: 'FaceLandmarker init failed' })
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
