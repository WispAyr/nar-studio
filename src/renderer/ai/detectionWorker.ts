/**
 * Face-detection worker. Runs MediaPipe FaceLandmarker off the renderer thread:
 * the main thread sends camera frames as transferable ImageBitmaps, and the
 * expensive (blocking) detect() runs here so the UI and compositor never stall.
 *
 * Protocol
 *   in   { type: 'init', localWasm, localModel, cdnWasm, cdnModel }
 *   out  { type: 'ready', delegate } | { type: 'error', message }
 *   in   { type: 'detect', cam, bitmap }
 *   out  { type: 'result', cam, faces }
 */
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { resultToFaces } from './faceLandmarks'

// `self` is typed as Window under the DOM lib — cast away so worker calls build.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null
  postMessage: (msg: unknown) => void
}

let landmarker: FaceLandmarker | null = null

async function makeLandmarker(wasmBase: string, modelPath: string, gpu: boolean) {
  const vision = await FilesetResolver.forVisionTasks(wasmBase)
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelPath, delegate: gpu ? 'GPU' : 'CPU' },
    runningMode: 'IMAGE',
    numFaces: 5,
    outputFaceBlendshapes: true,
  })
}

ctx.onmessage = async (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === 'init') {
    // Local assets first, then CDN; GPU delegate first, then CPU. First that
    // loads wins — the renderer always gets a working detector if one exists.
    const attempts: [string, string, boolean][] = [
      [msg.localWasm, msg.localModel, true],
      [msg.cdnWasm, msg.cdnModel, true],
      [msg.localWasm, msg.localModel, false],
      [msg.cdnWasm, msg.cdnModel, false],
    ]
    for (const [wasm, model, gpu] of attempts) {
      if (!wasm || !model) continue
      try {
        landmarker = await makeLandmarker(wasm, model, gpu)
        ctx.postMessage({ type: 'ready', delegate: gpu ? 'GPU' : 'CPU' })
        return
      } catch { /* try the next source / delegate */ }
    }
    ctx.postMessage({ type: 'error', message: 'FaceLandmarker init failed' })
    return
  }

  if (msg.type === 'detect') {
    const { cam, bitmap } = msg as { cam: number; bitmap: ImageBitmap }
    let faces: ReturnType<typeof resultToFaces> = []
    try {
      if (landmarker) faces = resultToFaces(landmarker.detect(bitmap))
    } catch { /* a bad frame — report no faces and carry on */ }
    bitmap.close()
    ctx.postMessage({ type: 'result', cam, faces })
  }
}
