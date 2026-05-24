import { useCallback, useEffect, useRef, useState } from 'react'

const studio = (window as any).studio

/** idle = not streaming · live = healthy · reconnecting / lost = RTMP dropped. */
export type StreamStatus = 'idle' | 'live' | 'reconnecting' | 'lost'

/** Quality preset id mirrored from the main process. */
export type StreamQualityPreset =
  | 'performance' | 'standard' | 'high' | 'maximum' | 'nvenc-high' | 'nvenc-max'

export interface StreamStats {
  frames: number
  fps: number
  bitrateK: number
  speed: number
  drops: number
  q: number
}

function readQualityPref(): StreamQualityPreset {
  const v = localStorage.getItem('nar-stream-quality') as StreamQualityPreset | null
  const allowed: StreamQualityPreset[] = ['performance', 'standard', 'high', 'maximum', 'nvenc-high', 'nvenc-max']
  return v && allowed.includes(v) ? v : 'standard'
}

function pickMime(): string {
  const opts = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  return opts.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm'
}

/** Read secondary RTMP destinations the operator entered in the Stream panel. */
function readSimulcast(): string[] {
  try {
    const raw = localStorage.getItem('nar-stream-simulcast')
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr)
      ? arr.map((s: unknown) => typeof s === 'string' ? s.trim() : '').filter(Boolean)
      : []
  } catch { return [] }
}

interface Session {
  rtmpUrl: string
  streamKey: string
  audio: MediaStream | null
  recorder: MediaRecorder | null
  attempt: number
  reconnectTimer: number | null
  confirmTimer: number | null
  userStopped: boolean
}

/** Stop and discard a session's MediaRecorder without running teardown logic. */
function killRecorder(s: Session) {
  const r = s.recorder
  s.recorder = null
  if (r) {
    r.ondataavailable = null
    try { if (r.state !== 'inactive') r.stop() } catch { /* ignore */ }
  }
}

/**
 * Streams the built-in program output to RTMP and recovers from RTMP drops.
 *
 * FFmpeg in the main process pushes the stream; if YouTube/RTMP drops it exits
 * and signals back over `onStreamEnded`. Because FFmpeg needs a fresh WebM
 * header, a reconnect means relaunching FFmpeg *and* the MediaRecorder — done
 * here with exponential backoff, holding 'reconnecting' until the link proves
 * stable so the operator is never shown a false "LIVE".
 */
export function useBuiltinStreamer(
  getProgramStream: () => MediaStream | null,
  /**
   * Optional getter for the processed broadcast audio. When provided the
   * streamer uses these tracks instead of opening its own `getUserMedia`,
   * so the operator's compressor/limiter/HPF actually reach the FFmpeg
   * encoder. The hook never stops these tracks — the provider owns them.
   */
  getBroadcastAudio?: () => MediaStream | null,
) {
  const [status, setStatus] = useState<StreamStatus>('idle')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [stats, setStats] = useState<StreamStats | null>(null)
  const sref = useRef<Session | null>(null)
  const reconnectRef = useRef<() => void>(() => {})

  // Stream stats — FFmpeg pushes one event per second while live.
  useEffect(() => {
    const off = studio?.onStreamStats?.((s: StreamStats) => setStats(s))
    return () => off?.()
  }, [])

  // Build + start a MediaRecorder feeding the current FFmpeg. False = no video.
  const spawnRecorder = useCallback((s: Session): boolean => {
    const videoTrack = getProgramStream()?.getVideoTracks()[0]
    if (!videoTrack) return false
    const tracks: MediaStreamTrack[] = [videoTrack]
    if (s.audio) tracks.push(...s.audio.getAudioTracks())
    const recorder = new MediaRecorder(new MediaStream(tracks), {
      mimeType: pickMime(),
      // Near-lossless intermediate: this only travels over local IPC to FFmpeg,
      // which does the real (H.264) compression.
      videoBitsPerSecond: 25_000_000,
    })
    recorder.ondataavailable = async (e: BlobEvent) => {
      if (e.data && e.data.size > 0) studio.builtinStreamWrite(await e.data.arrayBuffer())
    }
    recorder.start(500)
    s.recorder = recorder
    return true
  }, [getProgramStream])

  // Arm the next reconnect with exponential backoff (2,4,8,16,30s, capped).
  const scheduleReconnect = useCallback(() => {
    const s = sref.current
    if (!s || s.userStopped || s.reconnectTimer != null) return
    s.attempt += 1
    setStatus(s.attempt <= 3 ? 'reconnecting' : 'lost')
    const delay = Math.min(30, 2 ** Math.min(s.attempt, 5)) * 1000
    s.reconnectTimer = window.setTimeout(() => reconnectRef.current(), delay)
  }, [])

  // Relaunch FFmpeg + a fresh MediaRecorder. Only promotes to 'live' once the
  // new link has held for a few seconds, so a flapping connection stays honest.
  const reconnect = useCallback(async () => {
    const s = sref.current
    if (!s || s.userStopped) return
    s.reconnectTimer = null
    let res: { ok?: boolean } | null = null
    try { res = await studio.builtinStreamStart(s.rtmpUrl, s.streamKey, readSimulcast(), readQualityPref()) } catch { res = null }
    const cur = sref.current
    if (!cur || cur.userStopped) { studio.builtinStreamStop?.(); return }
    if (!res?.ok) { scheduleReconnect(); return }
    if (!spawnRecorder(cur)) { studio.builtinStreamStop?.(); scheduleReconnect(); return }
    cur.confirmTimer = window.setTimeout(() => {
      const ss = sref.current
      if (ss && !ss.userStopped) { ss.attempt = 0; ss.confirmTimer = null; setStatus('live') }
    }, 9000)
  }, [spawnRecorder, scheduleReconnect])
  reconnectRef.current = reconnect

  // FFmpeg signalled the RTMP link dropped — tear down and reconnect.
  useEffect(() => {
    const off = studio?.onStreamEnded?.(() => {
      const s = sref.current
      if (!s || s.userStopped || s.reconnectTimer != null) return
      if (s.confirmTimer != null) { clearTimeout(s.confirmTimer); s.confirmTimer = null }
      killRecorder(s)
      scheduleReconnect()
    })
    return () => off?.()
  }, [scheduleReconnect])

  const start = useCallback(async (rtmpUrl: string, streamKey: string) => {
    if (sref.current) return
    const videoTrack = getProgramStream()?.getVideoTracks()[0]
    if (!videoTrack) throw new Error('No program video to stream')

    // Prefer the processed broadcast bus when the caller provides one — that
    // way the compressor/limiter/HPF reach FFmpeg. Fall back to a raw device
    // capture only when no bus is available (older callers, tests).
    let audio: MediaStream | null = getBroadcastAudio?.() ?? null
    let ownedAudio = false
    if (!audio) {
      const savedAudio = localStorage.getItem('nar-audio-device')
      try {
        audio = await navigator.mediaDevices.getUserMedia({
          audio: savedAudio ? { deviceId: { exact: savedAudio } } : true,
        })
        ownedAudio = true
      } catch {
        try { audio = await navigator.mediaDevices.getUserMedia({ audio: true }); ownedAudio = true }
        catch { /* ignore */ }
      }
    }

    let res: { ok?: boolean; error?: string } | null = null
    try { res = await studio.builtinStreamStart(rtmpUrl, streamKey, readSimulcast(), readQualityPref()) } catch { res = null }
    if (!res?.ok) {
      if (ownedAudio) audio?.getTracks().forEach(t => t.stop())
      throw new Error(res?.error || 'Failed to start stream')
    }

    const s: Session = {
      rtmpUrl, streamKey, audio, recorder: null,
      attempt: 0, reconnectTimer: null, confirmTimer: null, userStopped: false,
    }
    // Mark whether we own the tracks — only owned tracks get stopped on stop().
    ;(s as Session & { ownedAudio?: boolean }).ownedAudio = ownedAudio
    sref.current = s
    if (!spawnRecorder(s)) {
      studio.builtinStreamStop()
      if (ownedAudio) audio?.getTracks().forEach(t => t.stop())
      sref.current = null
      throw new Error('No program video to stream')
    }
    setStatus('live')
    setStartedAt(Date.now())
  }, [getProgramStream, getBroadcastAudio, spawnRecorder])

  const stop = useCallback(() => {
    const s = sref.current
    if (!s) return
    s.userStopped = true
    if (s.reconnectTimer != null) clearTimeout(s.reconnectTimer)
    if (s.confirmTimer != null) clearTimeout(s.confirmTimer)
    killRecorder(s)
    studio.builtinStreamStop()
    // Only stop tracks we opened ourselves — caller-supplied broadcast tracks
    // belong to the BroadcastAudioProvider.
    if ((s as Session & { ownedAudio?: boolean }).ownedAudio) {
      s.audio?.getTracks().forEach(t => t.stop())
    }
    sref.current = null
    setStatus('idle')
    setStartedAt(null)
    setStats(null)
  }, [])

  return { status, streaming: status !== 'idle', startedAt, start, stop, stats }
}
