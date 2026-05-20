import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useCameraStreams } from '../camera/CameraStreamProvider'
import { useBuiltinRecorder, type RecordingShow } from './useBuiltinRecorder'
import { useBuiltinStreamer } from './useBuiltinStreamer'
import { useSchedule } from '../hooks/useSchedule'
import type { EngineId, EngineSource } from './types'

const studio = (window as any).studio

const PROGRAM_W = 1920
const PROGRAM_H = 1080
const OBS_SCENE_FOR_CAM = ['CAM1', 'CAM2', 'CAM3', 'CAM4']

interface ObsRaw {
  connected: boolean
  streaming: boolean
  recording: boolean
  programScene: string
  scenes: string[]
  streamTimecode: string | null
  recordTimecode: string | null
}

interface EngineContextValue {
  engineId: EngineId
  setEngineId: (id: EngineId) => void
  /** obs: websocket connected. builtin: always true. */
  connected: boolean
  programSource: string
  sources: EngineSource[]
  obsScenes: string[]
  recording: boolean
  streaming: boolean
  recordTimecode: string | null
  streamTimecode: string | null
  recordingStartedAt: number | null
  recordingFile: string | null
  startRecording: (show: RecordingShow | null) => Promise<void>
  stopRecording: () => void
  autoRecord: boolean
  setAutoRecord: (on: boolean) => void
  streamStartedAt: number | null
  startStream: (rtmpUrl: string, streamKey: string) => Promise<void>
  stopStream: () => void
  cut: (sourceKey: string) => void
  /** The built-in compositor output canvas (1080p). */
  getProgramCanvas: () => HTMLCanvasElement | null
  /** Lazily-captured MediaStream of the program canvas. */
  getProgramStream: () => MediaStream | null
}

const Ctx = createContext<EngineContextValue | null>(null)

export function EngineProvider({ children }: { children: ReactNode }) {
  const { sources: camSources, videoEls } = useCameraStreams()

  const [engineId, setEngineIdState] = useState<EngineId>(
    () => (localStorage.getItem('nar-engine') as EngineId) || 'builtin'
  )
  const setEngineId = useCallback((id: EngineId) => {
    localStorage.setItem('nar-engine', id)
    setEngineIdState(id)
  }, [])

  // ── OBS engine state (IPC bridge) ─────────────────────────────────────────
  const [obs, setObs] = useState<ObsRaw>({
    connected: false, streaming: false, recording: false,
    programScene: '', scenes: [], streamTimecode: null, recordTimecode: null,
  })
  useEffect(() => {
    studio?.getObsState?.().then((s: ObsRaw) => { if (s) setObs(s) })
    const unsub = studio?.onObsState?.((s: ObsRaw) => setObs(s))
    return () => unsub?.()
  }, [])

  // ── Built-in engine state ─────────────────────────────────────────────────
  const [builtinProgram, setBuiltinProgram] = useState('cam0')
  const builtinProgramRef = useRef(builtinProgram)
  builtinProgramRef.current = builtinProgram

  const masterCanvasRef = useRef<HTMLCanvasElement | null>(null)
  if (!masterCanvasRef.current) {
    const c = document.createElement('canvas')
    c.width = PROGRAM_W
    c.height = PROGRAM_H
    masterCanvasRef.current = c
  }
  const programStreamRef = useRef<MediaStream | null>(null)

  // Compositor loop — draws the active source onto the master canvas.
  useEffect(() => {
    if (engineId !== 'builtin') return
    const canvas = masterCanvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      ctx.fillStyle = '#070708'
      ctx.fillRect(0, 0, PROGRAM_W, PROGRAM_H)
      const key = builtinProgramRef.current
      const idx = key.startsWith('cam') ? Number(key.slice(3)) : -1
      const v = idx >= 0 ? videoEls.current[idx] : null
      if (v && v.readyState >= 2 && v.videoWidth > 0) {
        const scale = Math.min(PROGRAM_W / v.videoWidth, PROGRAM_H / v.videoHeight)
        const w = v.videoWidth * scale
        const h = v.videoHeight * scale
        ctx.drawImage(v, (PROGRAM_W - w) / 2, (PROGRAM_H - h) / 2, w, h)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [engineId, videoEls])

  // ── Unified surface ───────────────────────────────────────────────────────
  const sources: EngineSource[] = Array.from({ length: 4 }, (_, i) => {
    const cam = camSources.find(c => c.index === i)
    return {
      key: `cam${i}`,
      label: `CAM ${i + 1}`,
      hasSignal: cam?.hasSignal ?? false,
    }
  })

  const obsSceneToKey = (scene: string) => {
    const i = OBS_SCENE_FOR_CAM.indexOf(scene)
    return i >= 0 ? `cam${i}` : scene
  }

  const cut = useCallback((sourceKey: string) => {
    if (engineId === 'builtin') {
      setBuiltinProgram(sourceKey)
    } else {
      const i = sourceKey.startsWith('cam') ? Number(sourceKey.slice(3)) : -1
      studio?.obsCut?.(i >= 0 ? OBS_SCENE_FOR_CAM[i] : sourceKey)
    }
  }, [engineId])

  const getProgramStream = useCallback(() => {
    if (!programStreamRef.current && masterCanvasRef.current) {
      programStreamRef.current = masterCanvasRef.current.captureStream(30)
    }
    return programStreamRef.current
  }, [])

  const builtinRec = useBuiltinRecorder(getProgramStream)
  const builtinStream = useBuiltinStreamer(getProgramStream)

  // Auto-record at NAR show boundaries (built-in engine).
  const schedule = useSchedule()
  const [autoRecord, setAutoRecordState] = useState(() => localStorage.getItem('nar-auto-record') !== 'off')
  const setAutoRecord = useCallback((on: boolean) => {
    localStorage.setItem('nar-auto-record', on ? 'on' : 'off')
    setAutoRecordState(on)
  }, [])
  const autoStartedRef = useRef(false)
  useEffect(() => {
    if (engineId !== 'builtin' || !autoRecord) return
    const live = schedule.current
    if (live && !builtinRec.recording) {
      autoStartedRef.current = true
      builtinRec.start(live).catch(err => console.error('[engine] auto-record failed:', err))
    } else if (!live && builtinRec.recording && autoStartedRef.current) {
      autoStartedRef.current = false
      builtinRec.stop()
    }
  }, [engineId, autoRecord, schedule.current, builtinRec.recording, builtinRec.start, builtinRec.stop])

  // Keyboard: 1-4 cut to a camera (vision-mixer convention), R toggles record.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const n = Number(e.key)
      if (n >= 1 && n <= 4) { cut(`cam${n - 1}`); return }
      if ((e.key === 'r' || e.key === 'R') && engineId === 'builtin') {
        if (builtinRec.recording) builtinRec.stop()
        else builtinRec.start(null).catch(err => console.error('[engine] record start failed:', err))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cut, engineId, builtinRec.recording, builtinRec.start, builtinRec.stop])

  const value: EngineContextValue = {
    engineId,
    setEngineId,
    connected: engineId === 'builtin' ? true : obs.connected,
    programSource: engineId === 'builtin' ? builtinProgram : obsSceneToKey(obs.programScene),
    sources,
    obsScenes: obs.scenes,
    recording: engineId === 'builtin' ? builtinRec.recording : obs.recording,
    streaming: engineId === 'builtin' ? builtinStream.streaming : obs.streaming,
    recordTimecode: engineId === 'builtin' ? null : obs.recordTimecode,
    streamTimecode: engineId === 'builtin' ? null : obs.streamTimecode,
    recordingStartedAt: engineId === 'builtin' ? builtinRec.startedAt : null,
    recordingFile: engineId === 'builtin' ? builtinRec.filePath : null,
    startRecording: builtinRec.start,
    stopRecording: builtinRec.stop,
    autoRecord,
    setAutoRecord,
    streamStartedAt: engineId === 'builtin' ? builtinStream.startedAt : null,
    startStream: builtinStream.start,
    stopStream: builtinStream.stop,
    cut,
    getProgramCanvas: () => masterCanvasRef.current,
    getProgramStream,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useEngine() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useEngine must be used within EngineProvider')
  return ctx
}
