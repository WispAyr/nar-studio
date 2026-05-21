/**
 * MediaPipe asset locations. The wasm runtime and model files are bundled into
 * `public/mediapipe/` by `scripts/prepare-assets.mjs`, so the app starts fast
 * and keeps working with no internet. The CDN URLs are a fallback used only
 * when the local copy is missing.
 */

export const CDN_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
export const CDN_FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
export const CDN_SEG_MODEL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'

/**
 * Resolve a file inside the bundled `public/mediapipe/` folder. Built relative
 * to the document so it works both under the Vite dev server and the packaged
 * `file://` build. Returns '' if it cannot be resolved.
 */
export function localMediapipe(file: string): string {
  try { return new URL('mediapipe/' + file, document.baseURI).href } catch { return '' }
}
