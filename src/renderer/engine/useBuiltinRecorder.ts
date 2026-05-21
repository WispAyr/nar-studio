import { useCallback, useEffect, useRef, useState } from 'react'
import { useCameraStreams } from '../camera/CameraStreamProvider'

const studio = (window as any).studio

export interface RecordingShow {
  name: string
  uid: string
  broadcaststart?: string
}

// vp8 is far lighter to encode than vp9 — used for the ISO files so 4 cameras
// plus the program (and any stream) don't overload the CPU. The program file
// keeps vp9 for quality.
function pickMime(preferVp8: boolean): string {
  const opts = preferVp8
    ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
    : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  return opts.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm'
}

/**
 * Records the built-in engine to disk. Always records the program output
 * (composited video + studio-desk audio). When ISO recording is enabled it
 * also records a clean, ungraded file per connected camera — each carrying the
 * desk audio as a sync reference — all into the same session folder.
 */
export function useBuiltinRecorder(getProgramStream: () => MediaStream | null) {
  const { streams: camStreams } = useCameraStreams()
  const camStreamsRef = useRef(camStreams)
  camStreamsRef.current = camStreams

  const [recording, setRecording] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [isoCount, setIsoCount] = useState(0)
  const [recordError, setRecordError] = useState<string | null>(null)
  const [recordIso, setRecordIsoState] = useState(() => localStorage.getItem('nar-record-iso') !== 'off')
  const ref = useRef<{ recorders: MediaRecorder[]; audio: MediaStream | null } | null>(null)

  const setRecordIso = useCallback((on: boolean) => {
    localStorage.setItem('nar-record-iso', on ? 'on' : 'off')
    setRecordIsoState(on)
  }, [])

  // A recording file failed to write on disk (disk full, permissions, …).
  useEffect(() => {
    const off = studio?.onRecError?.((msg: string) => setRecordError(msg))
    return () => off?.()
  }, [])

  const start = useCallback(async (show: RecordingShow | null) => {
    if (ref.current) return
    setRecordError(null)
    const program = getProgramStream()
    const programVideo = program?.getVideoTracks()[0]
    if (!programVideo) throw new Error('No program video to record')

    // Studio-desk audio (saved selection, falling back to default) — mixed into
    // the program and every ISO file so each angle has a sync sound reference.
    let audio: MediaStream | null = null
    const savedAudio = localStorage.getItem('nar-audio-device')
    try {
      audio = await navigator.mediaDevices.getUserMedia({
        audio: savedAudio ? { deviceId: { exact: savedAudio } } : true,
      })
    } catch {
      try { audio = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch {}
    }
    const audioTracks = audio ? audio.getAudioTracks() : []

    // Feeds to record: the program, then a clean ISO per connected camera.
    const feeds: { name: string; tracks: MediaStreamTrack[] }[] = [
      { name: 'program', tracks: [programVideo, ...audioTracks] },
    ]
    if (recordIso) {
      camStreamsRef.current.forEach((s, i) => {
        const v = s?.getVideoTracks()[0]
        if (v) feeds.push({ name: `cam${i + 1}`, tracks: [v, ...audioTracks] })
      })
    }

    const recorders: MediaRecorder[] = []
    let programFile: string | null = null
    let remaining = feeds.length

    for (const feed of feeds) {
      const session = await studio.builtinRecStart(show, feed.name, 'webm')
      if (feed.name === 'program') programFile = session.filePath
      const id: string = session.id
      const isProgram = feed.name === 'program'
      const recorder = new MediaRecorder(new MediaStream(feed.tracks), {
        mimeType: pickMime(!isProgram),
        videoBitsPerSecond: isProgram ? 8_000_000 : 6_000_000,
      })
      recorder.ondataavailable = async (e: BlobEvent) => {
        if (e.data && e.data.size > 0) {
          studio.builtinRecWrite(id, await e.data.arrayBuffer())
        }
      }
      recorder.onstop = async () => {
        await studio.builtinRecStop(id)
        remaining -= 1
        if (remaining === 0) {
          audio?.getTracks().forEach(t => t.stop())
          ref.current = null
          setRecording(false)
          setStartedAt(null)
        }
      }
      recorder.start(1000)
      recorders.push(recorder)
    }

    ref.current = { recorders, audio }
    setRecording(true)
    setStartedAt(Date.now())
    setFilePath(programFile)
    setIsoCount(feeds.length - 1)
  }, [getProgramStream, recordIso])

  const stop = useCallback(() => {
    ref.current?.recorders.forEach(r => { try { r.stop() } catch { /* already stopped */ } })
  }, [])

  return { recording, startedAt, filePath, isoCount, recordError, recordIso, setRecordIso, start, stop }
}
