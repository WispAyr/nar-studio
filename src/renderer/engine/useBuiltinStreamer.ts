import { useCallback, useEffect, useRef, useState } from 'react'

const studio = (window as any).studio

/** idle = not streaming · live = healthy · reconnecting / lost = RTMP dropped. */
export type StreamStatus = 'idle' | 'live' | 'reconnecting' | 'lost'

function pickMime(): string {
  const opts = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  return opts.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm'
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
export function useBuiltinStreamer(getProgramStream: () => MediaStream | null) {
  const [status, setStatus] = useState<StreamStatus>('idle')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const sref = useRef<Session | null>(null)
  const reconnectRef = useRef<() => void>(() => {})

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
    try { res = await studio.builtinStreamStart(s.rtmpUrl, s.streamKey) } catch { res = null }
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

    let audio: MediaStream | null = null
    const savedAudio = localStorage.getItem('nar-audio-device')
    try {
      audio = await navigator.mediaDevices.getUserMedia({
        audio: savedAudio ? { deviceId: { exact: savedAudio } } : true,
      })
    } catch {
      try { audio = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch { /* ignore */ }
    }

    let res: { ok?: boolean; error?: string } | null = null
    try { res = await studio.builtinStreamStart(rtmpUrl, streamKey) } catch { res = null }
    if (!res?.ok) {
      audio?.getTracks().forEach(t => t.stop())
      throw new Error(res?.error || 'Failed to start stream')
    }

    const s: Session = {
      rtmpUrl, streamKey, audio, recorder: null,
      attempt: 0, reconnectTimer: null, confirmTimer: null, userStopped: false,
    }
    sref.current = s
    if (!spawnRecorder(s)) {
      studio.builtinStreamStop()
      audio?.getTracks().forEach(t => t.stop())
      sref.current = null
      throw new Error('No program video to stream')
    }
    setStatus('live')
    setStartedAt(Date.now())
  }, [getProgramStream, spawnRecorder])

  const stop = useCallback(() => {
    const s = sref.current
    if (!s) return
    s.userStopped = true
    if (s.reconnectTimer != null) clearTimeout(s.reconnectTimer)
    if (s.confirmTimer != null) clearTimeout(s.confirmTimer)
    killRecorder(s)
    studio.builtinStreamStop()
    s.audio?.getTracks().forEach(t => t.stop())
    sref.current = null
    setStatus('idle')
    setStartedAt(null)
  }, [])

  return { status, streaming: status !== 'idle', startedAt, start, stop }
}
