import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { useBroadcastAudio } from '../audio/BroadcastAudioProvider'

const studio = (window as any).studio

export interface ComplianceStatus {
  enabled: boolean
  retentionDays: number
  segmentMinutes: number
  baseDir: string
  currentFile: string | null
  currentBytes: number
  segmentStartedAt: string | null
  totalSegments: number
  totalBytes: number
  oldestSegmentDate: string | null
  lastError: string | null
}

interface ComplianceCtx {
  status: ComplianceStatus | null
  running: boolean
  setEnabled: (enabled: boolean) => Promise<void>
  setRetention: (days: number) => Promise<void>
  setSegment: (minutes: number) => Promise<void>
  openFolder: () => Promise<void>
  sweepNow: () => Promise<void>
}

const Ctx = createContext<ComplianceCtx | null>(null)

function pickMime(): string {
  const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
  return opts.find(m => MediaRecorder.isTypeSupported(m)) || 'audio/webm'
}

/**
 * Continuous as-broadcast logger for compliance. Captures the operator's
 * selected audio device, runs a MediaRecorder, and rotates the underlying
 * file every `segmentMinutes` so every WebM segment is self-contained and
 * plays back stand-alone.
 *
 * Rotation strategy: stop the current recorder cleanly, await its final
 * `dataavailable` flush, ask main to open a new segment file, then start a
 * fresh recorder bound to the same audio track. This intentionally drops a
 * sub-second gap between segments — acceptable for a 60-minute rotation —
 * in exchange for every file being independently playable.
 */
export function ComplianceProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ComplianceStatus | null>(null)
  const [running, setRunning] = useState(false)
  // Capture the as-broadcast signal — what actually went on-air, including
  // compressor/limiter — rather than the raw mic. That's what Ofcom expects.
  const { processedStream } = useBroadcastAudio()
  const processedStreamRef = useRef(processedStream)
  processedStreamRef.current = processedStream

  // Hold the live MediaRecorder + the segment id main is writing to.
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const segIdRef = useRef<string | null>(null)
  const rotateTimerRef = useRef<number | null>(null)
  const stoppingRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const s = await studio?.complianceStatus?.()
      if (s) setStatus(s)
    } catch { /* ignore */ }
  }, [])

  // Pull status every 5s while mounted — cheap, and the UI shows segment size.
  useEffect(() => {
    refresh()
    const id = window.setInterval(refresh, 5000)
    return () => window.clearInterval(id)
  }, [refresh])

  /** Stop the current MediaRecorder + close the segment file. */
  const closeSegment = useCallback(async () => {
    const rec = recorderRef.current
    const id = segIdRef.current
    recorderRef.current = null
    segIdRef.current = null
    if (rec && rec.state !== 'inactive') {
      // Wait for the final `dataavailable` before the file closes so we don't
      // truncate the tail of the segment.
      await new Promise<void>(resolve => {
        const done = () => { rec.removeEventListener('stop', done); resolve() }
        rec.addEventListener('stop', done)
        try { rec.stop() } catch { resolve() }
      })
    }
    if (id) {
      try { await studio?.complianceStopSegment?.(id) } catch { /* ignore */ }
    }
  }, [])

  /**
   * Open a fresh segment + recorder bound to the existing audio stream. If
   * there's no stream yet (first start) the caller provides one.
   */
  const openSegment = useCallback(async (stream: MediaStream): Promise<boolean> => {
    const opened = await studio?.complianceStartSegment?.('webm').catch(() => null) as
      { id: string } | null | undefined
    if (!opened?.id) return false
    segIdRef.current = opened.id
    const mime = pickMime()
    const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 96_000 })
    rec.ondataavailable = async e => {
      if (!e.data || e.data.size === 0) return
      const id = segIdRef.current
      if (!id) return
      try {
        const buf = await e.data.arrayBuffer()
        await studio?.complianceWrite?.(id, buf)
      } catch { /* ignore */ }
    }
    rec.start(1000)
    recorderRef.current = rec
    return true
  }, [])

  const startRunning = useCallback(async () => {
    if (running || stoppingRef.current) return
    // Prefer the processed broadcast bus so the log captures as-broadcast
    // audio. Fall back to raw device only if the bus isn't up yet (early
    // startup race) — settings will switch over on the next rotation.
    let stream: MediaStream | null = processedStreamRef.current
    let ownsTracks = false
    if (!stream) {
      try {
        const saved = localStorage.getItem('nar-audio-device')
        stream = await navigator.mediaDevices.getUserMedia({
          audio: saved ? { deviceId: { exact: saved } } : true,
        })
        ownsTracks = true
      } catch {
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); ownsTracks = true }
        catch { stream = null }
      }
    }
    if (!stream) {
      console.warn('[compliance] no audio device available')
      return
    }
    streamRef.current = stream
    ;(streamRef.current as MediaStream & { __ownsTracks?: boolean }).__ownsTracks = ownsTracks
    const ok = await openSegment(stream)
    if (!ok) {
      if (ownsTracks) stream.getTracks().forEach(t => t.stop())
      streamRef.current = null
      return
    }
    setRunning(true)
    refresh()
    // Schedule rotations. We chain setTimeout (not setInterval) so any drift
    // from a slow IPC round-trip doesn't compound across hours.
    const armRotate = () => {
      const mins = status?.segmentMinutes ?? 60
      rotateTimerRef.current = window.setTimeout(async () => {
        if (stoppingRef.current) return
        await closeSegment()
        const s = streamRef.current
        if (!s) return
        await openSegment(s)
        refresh()
        armRotate()
      }, Math.max(5, mins) * 60 * 1000)
    }
    armRotate()
  }, [running, openSegment, closeSegment, refresh, status?.segmentMinutes])

  const stopRunning = useCallback(async () => {
    if (stoppingRef.current) return
    stoppingRef.current = true
    if (rotateTimerRef.current != null) {
      clearTimeout(rotateTimerRef.current)
      rotateTimerRef.current = null
    }
    await closeSegment()
    const s = streamRef.current as (MediaStream & { __ownsTracks?: boolean }) | null
    if (s?.__ownsTracks) s.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setRunning(false)
    stoppingRef.current = false
    refresh()
  }, [closeSegment, refresh])

  // React to main's stored enabled flag — flip running on/off when it changes.
  useEffect(() => {
    if (!status) return
    if (status.enabled && !running) startRunning()
    else if (!status.enabled && running) stopRunning()
  }, [status?.enabled, running, startRunning, stopRunning])

  // Clean shutdown on unmount.
  useEffect(() => () => {
    stoppingRef.current = true
    if (rotateTimerRef.current != null) clearTimeout(rotateTimerRef.current)
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') { try { rec.stop() } catch { /* ignore */ } }
    const id = segIdRef.current
    if (id) studio?.complianceStopSegment?.(id).catch(() => {})
    const s = streamRef.current as (MediaStream & { __ownsTracks?: boolean }) | null
    if (s?.__ownsTracks) s.getTracks().forEach(t => t.stop())
  }, [])

  const setEnabled = useCallback(async (enabled: boolean) => {
    await studio?.complianceSetEnabled?.(enabled)
    await refresh()
  }, [refresh])

  const setRetention = useCallback(async (days: number) => {
    await studio?.complianceSetRetention?.(days)
    await refresh()
  }, [refresh])

  const setSegment = useCallback(async (minutes: number) => {
    await studio?.complianceSetSegment?.(minutes)
    await refresh()
  }, [refresh])

  const openFolder = useCallback(async () => { await studio?.complianceOpenFolder?.() }, [])
  const sweepNow = useCallback(async () => {
    await studio?.complianceSweep?.()
    await refresh()
  }, [refresh])

  return (
    <Ctx.Provider value={{
      status, running,
      setEnabled, setRetention, setSegment,
      openFolder, sweepNow,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useCompliance() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCompliance must be used inside ComplianceProvider')
  return ctx
}
