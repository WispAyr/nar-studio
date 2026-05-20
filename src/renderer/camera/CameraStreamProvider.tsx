import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type MutableRefObject } from 'react'

export const MAX_CAMERAS = 4
const RETRY_MS = 5000

export interface VideoSource {
  index: number
  deviceId: string
  label: string
  hasSignal: boolean
}

interface CameraStreamContextValue {
  sources: VideoSource[]
  streams: (MediaStream | null)[]
  /** Master <video> elements — one decode per camera, drawn by the compositor. */
  videoEls: MutableRefObject<(HTMLVideoElement | null)[]>
}

const Ctx = createContext<CameraStreamContextValue | null>(null)

const emptyArr = <T,>(v: T): T[] => Array.from({ length: MAX_CAMERAS }, () => v)

/**
 * Opens the OBSBot camera feeds once and shares them. Both the multiview tiles
 * and the built-in compositor consume from here, so each camera is opened a
 * single time regardless of how many places display it.
 *
 * UVC capture devices are exclusive on Windows — if OBS (or another app) holds
 * a camera, getUserMedia fails. Failed cameras are retried so they recover
 * automatically once released.
 */
export function CameraStreamProvider({ children }: { children: ReactNode }) {
  const [sources, setSources] = useState<VideoSource[]>([])
  const [streams, setStreams] = useState<(MediaStream | null)[]>(emptyArr(null))
  const videoEls = useRef<(HTMLVideoElement | null)[]>(emptyArr(null))
  const streamsRef = useRef<(MediaStream | null)[]>(emptyArr(null))

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const stopAll = () => {
      streamsRef.current.forEach(s => s?.getTracks().forEach(t => t.stop()))
      streamsRef.current = emptyArr(null)
    }

    async function attempt() {
      // A getUserMedia grant is required before enumerateDevices() exposes labels.
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        probe.getTracks().forEach(t => t.stop())
      } catch {}
      if (cancelled) return

      const devices = await navigator.mediaDevices.enumerateDevices()
      let cams = devices.filter(d => d.kind === 'videoinput' && !/virtual/i.test(d.label))
      const obsbot = cams.filter(d => /obsbot/i.test(d.label))
      if (obsbot.length > 0) cams = obsbot
      cams = cams.slice().sort((a, b) => a.deviceId.localeCompare(b.deviceId)).slice(0, MAX_CAMERAS)

      // Open any slot that isn't already streaming.
      for (let i = 0; i < cams.length; i++) {
        if (streamsRef.current[i]) continue
        const dev = cams[i]
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: dev.deviceId },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              frameRate: { ideal: 30 },
            },
            audio: false,
          })
          if (cancelled) {
            stream.getTracks().forEach(t => t.stop())
            return
          }
          streamsRef.current[i] = stream
        } catch (e) {
          console.warn(`[camera] camera ${i} (${dev.label || dev.deviceId}) failed:`, (e as Error).name, (e as Error).message)
        }
      }
      if (cancelled) return

      const next = streamsRef.current.slice()
      setStreams(next)
      setSources(cams.map((d, i) => ({
        index: i,
        deviceId: d.deviceId,
        label: d.label || `Camera ${i + 1}`,
        hasSignal: !!next[i],
      })))

      const missing = cams.some((_, i) => !streamsRef.current[i])
      if (missing && !cancelled) {
        retryTimer = setTimeout(attempt, RETRY_MS)
      }
    }

    attempt()

    const onChange = () => {
      stopAll()
      setStreams(emptyArr(null))
      if (retryTimer) clearTimeout(retryTimer)
      attempt()
    }
    navigator.mediaDevices.addEventListener('devicechange', onChange)

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      navigator.mediaDevices.removeEventListener('devicechange', onChange)
      stopAll()
    }
  }, [])

  // Bind streams to the master video elements and keep them decoding.
  useEffect(() => {
    streams.forEach((s, i) => {
      const el = videoEls.current[i]
      if (el && el.srcObject !== s) {
        el.srcObject = s
        if (s) el.play().catch(() => {})
      }
    })
  }, [streams])

  return (
    <Ctx.Provider value={{ sources, streams, videoEls }}>
      {/* Master decode elements — rendered off-screen at a real size so the
          browser keeps decoding frames for the compositor to draw. */}
      <div style={{ position: 'fixed', left: '-10000px', top: 0, pointerEvents: 'none' }} aria-hidden>
        {Array.from({ length: MAX_CAMERAS }, (_, i) => (
          <video
            key={i}
            ref={el => { videoEls.current[i] = el }}
            autoPlay
            muted
            playsInline
            width={160}
            height={90}
          />
        ))}
      </div>
      {children}
    </Ctx.Provider>
  )
}

export function useCameraStreams() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCameraStreams must be used within CameraStreamProvider')
  return ctx
}
