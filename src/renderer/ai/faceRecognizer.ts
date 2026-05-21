/**
 * Face-recognition embeddings via face-api.js.
 *
 * This wraps the purpose-built face-recognition network (a face-trained model,
 * not a general image embedder) — it produces 128-d descriptors where the same
 * person clusters tightly and different people separate cleanly. Descriptors
 * are compared by Euclidean distance (the face-api convention: < ~0.6 = same).
 */
import * as faceapi from '@vladmandic/face-api'

// The model ships inside the npm package — served here from the same CDN the
// MediaPipe models load from, so the offline characteristic is unchanged.
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model'

let loadPromise: Promise<void> | null = null

/**
 * Load the face-recognition model once. Safe to call repeatedly. face-api
 * initialises its TensorFlow.js backend automatically on first load.
 */
export function loadFaceRecognizer(): Promise<void> {
  if (!loadPromise) {
    loadPromise = faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
  }
  return loadPromise
}

export function recognizerReady(): boolean {
  return faceapi.nets.faceRecognitionNet.isLoaded
}

/**
 * Compute a 128-d face descriptor from an aligned face image (≈150×150,
 * eyes levelled). Returns null if the model isn't ready or inference fails.
 */
export async function describeFace(face: HTMLCanvasElement): Promise<Float32Array | null> {
  if (!faceapi.nets.faceRecognitionNet.isLoaded) return null
  try {
    const d = await faceapi.computeFaceDescriptor(face)
    return Array.isArray(d) ? (d[0] ?? null) : d
  } catch {
    return null
  }
}
