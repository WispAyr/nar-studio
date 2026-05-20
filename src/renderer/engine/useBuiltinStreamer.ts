import { useCallback, useRef, useState } from 'react'

const studio = (window as any).studio

function pickMime(): string {
  const opts = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  return opts.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm'
}

/**
 * Streams the built-in program output to RTMP. The program canvas is mixed
 * with the studio-desk audio, encoded by MediaRecorder, and the chunks are
 * piped to a bundled FFmpeg in the main process which pushes to RTMP.
 */
export function useBuiltinStreamer(getProgramStream: () => MediaStream | null) {
  const [streaming, setStreaming] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const ref = useRef<{ recorder: MediaRecorder; audio: MediaStream | null } | null>(null)

  const start = useCallback(async (rtmpUrl: string, streamKey: string) => {
    if (ref.current) return
    const program = getProgramStream()
    const videoTrack = program?.getVideoTracks()[0]
    if (!videoTrack) throw new Error('No program video to stream')

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

    const res = await studio.builtinStreamStart(rtmpUrl, streamKey)
    if (!res?.ok) {
      audio?.getTracks().forEach(t => t.stop())
      throw new Error(res?.error || 'Failed to start stream')
    }

    const recorder = new MediaRecorder(mixed, {
      mimeType: pickMime(),
      videoBitsPerSecond: 6_000_000,
    })
    recorder.ondataavailable = async (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        studio.builtinStreamWrite(await e.data.arrayBuffer())
      }
    }
    recorder.onstop = async () => {
      await studio.builtinStreamStop()
      audio?.getTracks().forEach(t => t.stop())
      ref.current = null
      setStreaming(false)
      setStartedAt(null)
    }
    recorder.start(500)
    ref.current = { recorder, audio }
    setStreaming(true)
    setStartedAt(Date.now())
  }, [getProgramStream])

  const stop = useCallback(() => {
    ref.current?.recorder.stop()
  }, [])

  return { streaming, startedAt, start, stop }
}
