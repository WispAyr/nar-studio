/**
 * Bundle the MediaPipe wasm runtime + model files into public/mediapipe/ so the
 * app starts fast and runs offline. The wasm is copied from the installed npm
 * package; the models are downloaded once. Anything that fails here is
 * non-fatal — the renderer falls back to the CDN for whatever is missing.
 *
 * Runs on `postinstall` and before `build`. Re-run manually: npm run prepare-assets
 */
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public', 'mediapipe')
const wasmOut = path.join(outDir, 'wasm')

const MODELS = [
  ['face_landmarker.task',
   'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'],
  ['selfie_segmenter.tflite',
   'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'],
]

function download(url, dest, redirects = 0) {
  return new Promise(resolve => {
    https.get(url, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
        res.resume()
        return resolve(download(res.headers.location, dest, redirects + 1))
      }
      if (res.statusCode !== 200) {
        console.warn(`[prepare-assets] ${path.basename(dest)} download failed: HTTP ${res.statusCode}`)
        res.resume()
        return resolve(false)
      }
      const file = fs.createWriteStream(dest)
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve(true)))
      file.on('error', () => resolve(false))
    }).on('error', e => {
      console.warn(`[prepare-assets] ${path.basename(dest)} download error: ${e.message}`)
      resolve(false)
    })
  })
}

async function main() {
  fs.mkdirSync(wasmOut, { recursive: true })

  // MediaPipe wasm runtime — copied from the installed npm package.
  const wasmSrc = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
  try {
    fs.cpSync(wasmSrc, wasmOut, { recursive: true })
    console.log('[prepare-assets] copied MediaPipe wasm runtime')
  } catch (e) {
    console.warn('[prepare-assets] wasm copy skipped (app will use the CDN):', e.message)
  }

  // Model files — downloaded once; skipped if already present.
  for (const [name, url] of MODELS) {
    const dest = path.join(outDir, name)
    if (fs.existsSync(dest) && fs.statSync(dest).size > 100_000) {
      console.log(`[prepare-assets] ${name} already present`)
      continue
    }
    const ok = await download(url, dest)
    if (ok) console.log(`[prepare-assets] downloaded ${name}`)
    else { try { fs.rmSync(dest, { force: true }) } catch { /* ignore */ } }
  }

  console.log('[prepare-assets] done — anything missing is fetched from the CDN at runtime.')
}

main().catch(e => {
  console.warn('[prepare-assets] skipped:', e.message)
  process.exit(0)
})
