import { useCallback, useRef, useState } from 'react'

const studio = (window as any).studio

export interface RecordingShow {
  name: string
  uid: string
  broadcaststart?: string
}

function pickMime(): string {
  const opts = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  return opts.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm'
}

/**
 * Records the built-in program output. The program canvas (video) is mixed
 * with the selected studio-desk audio device and encoded by MediaRecorder;
 * chunks stream to the main process which writes them to disk.
 */
export function useBuiltinRecorder(getProgramStream: () => MediaStream | null) {
  const [recording, setRecording] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const ref = useRef<{ recorder: MediaRecorder; audio: MediaStream | null } | null>(null)

  const start = useCallback(async (show: RecordingShow | null) => {
    if (ref.current) return
    const program = getProgramStream()
    const videoTrack = program?.getVideoTracks()[0]
    if (!videoTrack) throw new Error('No program video to record')

    // Mix in the studio-desk audio (saved selection, falling back to default).
    let audio: MediaStream | null = null
    const savedAudio = localStorage.getItem('nar-audio-device')
    try {
      audio = await navigator.mediaDevices.getUserMedia({
        audio: savedAudio ? { deviceId: { exact: savedAudio } } : true,
      })
    } catch {
      try { audio = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch {}
    }

    const tracks: MediaStreamTrack[] = [videoTrack]
    if (audio) tracks.push(...audio.getAudioTracks())
    const mixed = new MediaStream(tracks)

    const recorder = new MediaRecorder(mixed, {
      mimeType: pickMime(),
      videoBitsPerSecond: 8_000_000,
    })
    const session = await studio.builtinRecStart(show, 'webm')

    recorder.ondataavailable = async (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        studio.builtinRecWrite(session.id, await e.data.arrayBuffer())
      }
    }
    recorder.onstop = async () => {
      await studio.builtinRecStop()
      audio?.getTracks().forEach(t => t.stop())
      ref.current = null
      setRecording(false)
      setStartedAt(null)
    }
    recorder.start(1000)
    ref.current = { recorder, audio }
    setRecording(true)
    setStartedAt(Date.now())
    setFilePath(session.filePath)
  }, [getProgramStream])

  const stop = useCallback(() => {
    ref.current?.recorder.stop()
  }, [])

  return { recording, startedAt, filePath, start, stop }
}
