import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from 'react'
import { useViz } from '../viz/VizProvider'
import { useEngine } from '../engine/EngineProvider'
import { useBroadcastAudio } from '../audio/BroadcastAudioProvider'

const RING_SECONDS = 60
const TIMESLICE_MS = 1000
const BITRATE = 4_000_000

interface ReplayContextValue {
  /** Whether the rolling buffer is being captured. */
  enabled: boolean
  setEnabled: (on: boolean) => void
  /** Seconds of footage currently in the ring (0..RING_SECONDS). */
  bufferSec: number
  /** Save the current rolling buffer to a .webm download. */
  saveClip: () => void
  /** True when the browser exposes the APIs needed. */
  supported: boolean
  /** Which canvas the buffer is currently recording from. */
  source: 'program' | 'viz' | null
  /** True when the clip will include the studio audio track. */
  hasAudio: boolean
}

const Ctx = createContext<ReplayContextValue | null>(null)

const REPLAY_SUPPORTED =
  typeof window !== 'undefined' &&
  typeof MediaRecorder !== 'undefined' &&
  typeof (HTMLCanvasElement.prototype as { captureStream?: () => MediaStream }).captureStream !== 'undefined'

function pickMimeType(withAudio: boolean): string | null {
  const candidates = withAudio
    ? [
        'video/webm; codecs="vp9, opus"',
        'video/webm; codecs="vp8, opus"',
        'video/webm; codecs=vp9',
        'video/webm; codecs=vp8',
        'video/webm',
      ]
    : ['video/webm; codecs=vp9', 'video/webm; codecs=vp8', 'video/webm']
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return null
}

/**
 * Rolling 60-second buffer of the program output (or visualizer as a fallback)
 * with the studio audio track. The operator clicks "Save clip" to download
 * the most recent 60s as a webm — handy for socials and post-show highlights
 * without interrupting the broadcast.
 */
export function ReplayProvider({ children }: { children: ReactNode }) {
  const viz = useViz()
  const engine = useEngine()
  const { processedStream } = useBroadcastAudio()
  const processedAudioRef = useRef(processedStream)
  processedAudioRef.current = processedStream
  const recRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [enabled, setEnabledState] = useState(() => localStorage.getItem('nar-replay-enabled') === 'on')
  const [bufferSec, setBufferSec] = useState(0)
  const [source, setSource] = useState<'program' | 'viz' | null>(null)
  const [hasAudio, setHasAudio] = useState(false)

  const setEnabled = useCallback((on: boolean) => {
    localStorage.setItem('nar-replay-enabled', on ? 'on' : 'off')
    setEnabledState(on)
  }, [])

  // Keep the visualizer rendering when we're falling back to the viz canvas.
  // Acquire unconditionally while enabled — cheap insurance that frames flow.
  useEffect(() => {
    if (!enabled) return
    return viz.acquire()
  }, [enabled, viz])

  useEffect(() => {
    if (!enabled || !REPLAY_SUPPORTED) return
    // Prefer the program (compositor) canvas; fall back to viz only.
    const programCanvas = engine.getProgramCanvas?.() ?? null
    const canvas = programCanvas ?? viz.getCanvas()
    if (!canvas) {
      console.warn('[replay] no canvas yet — try again')
      return
    }
    const usingProgram = !!programCanvas
    setSource(usingProgram ? 'program' : 'viz')

    let stream: MediaStream
    try {
      stream = (canvas as HTMLCanvasElement & { captureStream(fr: number): MediaStream }).captureStream(30)
    } catch (e) {
      console.error('[replay] captureStream failed:', e)
      setSource(null)
      return
    }

    let cancelled = false
    let mediaRec: MediaRecorder | null = null
    let audioStream: MediaStream | null = null
    let ownsAudio = false

    const start = async () => {
      // Prefer the processed broadcast bus so clips sound as-broadcast
      // (compressor/limiter applied). Fall back to a raw device capture only
      // if the bus isn't up yet (early-boot race).
      try {
        const bus = processedAudioRef.current
        if (bus) {
          audioStream = bus
          ownsAudio = false
        } else {
          const audioDeviceId = localStorage.getItem('nar-audio-device') || ''
          audioStream = await navigator.mediaDevices.getUserMedia({
            audio: audioDeviceId
              ? { deviceId: { exact: audioDeviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
              : true,
            video: false,
          })
          ownsAudio = true
        }
        if (cancelled) {
          if (ownsAudio) audioStream.getTracks().forEach(t => t.stop())
          audioStream = null
          return
        }
        for (const t of audioStream.getAudioTracks()) stream.addTrack(t)
      } catch (e) {
        console.warn('[replay] no audio — clip will be silent:', (e as Error).message)
      }

      const mimeType = pickMimeType(!!audioStream)
      if (!mimeType) {
        console.error('[replay] no supported MediaRecorder mime type')
        stream.getTracks().forEach(t => t.stop())
        if (ownsAudio) audioStream?.getTracks().forEach(t => t.stop())
        return
      }
      const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: BITRATE })
      chunksRef.current = []
      rec.ondataavailable = e => {
        if (e.data.size === 0) return
        chunksRef.current.push(e.data)
        while (chunksRef.current.length > RING_SECONDS) chunksRef.current.shift()
        setBufferSec(chunksRef.current.length)
      }
      try {
        rec.start(TIMESLICE_MS)
      } catch (e) {
        console.error('[replay] start failed:', e)
        stream.getTracks().forEach(t => t.stop())
        if (ownsAudio) audioStream?.getTracks().forEach(t => t.stop())
        return
      }
      mediaRec = rec
      recRef.current = rec
      streamRef.current = stream
      audioStreamRef.current = audioStream
      setHasAudio(!!audioStream)
    }
    start()

    return () => {
      cancelled = true
      try { mediaRec?.stop() } catch { /* ignore */ }
      stream.getTracks().forEach(t => t.stop())
      // Only stop tracks we opened ourselves — broadcast-bus tracks live in
      // the BroadcastAudioProvider and must keep going for the next replay arm.
      if (ownsAudio) audioStream?.getTracks().forEach(t => t.stop())
      recRef.current = null
      streamRef.current = null
      audioStreamRef.current = null
      chunksRef.current = []
      setBufferSec(0)
      setSource(null)
      setHasAudio(false)
    }
  }, [enabled, viz, engine])

  const saveClip = useCallback(() => {
    if (chunksRef.current.length === 0) return
    const blob = new Blob(chunksRef.current, { type: 'video/webm' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nar-clip-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }, [])

  return (
    <Ctx.Provider value={{ enabled, setEnabled, bufferSec, saveClip, supported: REPLAY_SUPPORTED, source, hasAudio }}>
      {children}
    </Ctx.Provider>
  )
}

export function useReplay() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useReplay must be used within ReplayProvider')
  return ctx
}
