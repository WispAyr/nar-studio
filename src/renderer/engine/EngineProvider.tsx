import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useCameraStreams } from '../camera/CameraStreamProvider'
import { useCG } from '../cg/CGProvider'
import { useBuiltinRecorder, type RecordingShow } from './useBuiltinRecorder'
import { useBuiltinStreamer } from './useBuiltinStreamer'
import { useSchedule } from '../hooks/useSchedule'
import { SLOT_COUNT, type EngineId, type EngineSource, type TransitionType, type LayoutType } from './types'

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

interface BuiltinProgram {
  layout: LayoutType
  slots: number[] // camera indices — solo:[a], split:[left,right], pip:[main,inset]
}

interface EngineContextValue {
  engineId: EngineId
  setEngineId: (id: EngineId) => void
  /** obs: websocket connected. builtin: always true. */
  connected: boolean
  programSource: string
  /** Camera indices currently live in the program (all layout slots). */
  programCams: number[]
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
  transition: TransitionType
  setTransition: (t: TransitionType) => void
  layout: LayoutType
  setLayout: (l: LayoutType) => void
  programSlots: number[]
  activeSlot: number
  setActiveSlot: (i: number) => void
  /** A full-screen video (bumper / ad break) taking over the program, or null. */
  bumper: { url: string; label: string } | null
  rollBumper: (url: string, label: string) => void
  stopBumper: () => void
  /** The built-in compositor output canvas (1080p). */
  getProgramCanvas: () => HTMLCanvasElement | null
  /** Lazily-captured MediaStream of the program canvas. */
  getProgramStream: () => MediaStream | null
}

const Ctx = createContext<EngineContextValue | null>(null)

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = PROGRAM_W
  c.height = PROGRAM_H
  return c
}

export function EngineProvider({ children }: { children: ReactNode }) {
  const { sources: camSources, videoEls } = useCameraStreams()
  const cg = useCG()
  const cgRef = useRef(cg)
  cgRef.current = cg

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
  const [builtinProgram, setBuiltinProgram] = useState<BuiltinProgram>({ layout: 'solo', slots: [0] })
  const builtinProgramRef = useRef(builtinProgram)
  builtinProgramRef.current = builtinProgram

  const [activeSlot, setActiveSlot] = useState(0)
  const activeSlotRef = useRef(activeSlot)
  activeSlotRef.current = activeSlot

  const [transition, setTransitionState] = useState<TransitionType>(
    () => (localStorage.getItem('nar-transition') as TransitionType) || 'cut'
  )
  const transitionRef = useRef(transition)
  transitionRef.current = transition
  const setTransition = useCallback((t: TransitionType) => {
    localStorage.setItem('nar-transition', t)
    setTransitionState(t)
  }, [])
  const activeTransitionRef = useRef<{ type: 'fade' | 'dip'; startedAt: number; durationMs: number } | null>(null)

  // Bumper / ad-break — a full-screen video that takes over the program.
  const [bumper, setBumper] = useState<{ url: string; label: string } | null>(null)
  const bumperRef = useRef(bumper)
  bumperRef.current = bumper
  const bumperVideoRef = useRef<HTMLVideoElement | null>(null)

  const masterCanvasRef = useRef<HTMLCanvasElement | null>(null)
  if (!masterCanvasRef.current) masterCanvasRef.current = makeCanvas()
  const prevCanvasRef = useRef<HTMLCanvasElement | null>(null)
  if (!prevCanvasRef.current) prevCanvasRef.current = makeCanvas()
  const programStreamRef = useRef<MediaStream | null>(null)

  /** Snapshot the current program frame and arm a transition (no-op for hard cut). */
  const beginTransition = useCallback(() => {
    const type = transitionRef.current
    if (type === 'cut') return
    const master = masterCanvasRef.current
    const prev = prevCanvasRef.current
    if (master && prev) {
      const pctx = prev.getContext('2d')!
      pctx.clearRect(0, 0, PROGRAM_W, PROGRAM_H)
      pctx.drawImage(master, 0, 0)
    }
    activeTransitionRef.current = {
      type,
      startedAt: performance.now(),
      durationMs: type === 'dip' ? 700 : 450,
    }
  }, [])

  // Compositor loop — renders the program layout + CG, with snapshot transitions.
  useEffect(() => {
    if (engineId !== 'builtin') return
    const canvas = masterCanvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0

    const drawCamInto = (
      camIdx: number, dx: number, dy: number, dw: number, dh: number, mode: 'cover' | 'contain',
    ) => {
      const v = camIdx >= 0 ? videoEls.current[camIdx] : null
      if (!v || v.readyState < 2 || v.videoWidth === 0) return
      const sw = v.videoWidth, sh = v.videoHeight
      const scale = mode === 'cover' ? Math.max(dw / sw, dh / sh) : Math.min(dw / sw, dh / sh)
      const w = sw * scale, h = sh * scale
      ctx.save()
      ctx.beginPath()
      ctx.rect(dx, dy, dw, dh)
      ctx.clip()
      ctx.drawImage(v, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h)
      ctx.restore()
    }

    const renderProgram = () => {
      ctx.fillStyle = '#070708'
      ctx.fillRect(0, 0, PROGRAM_W, PROGRAM_H)
      const { layout, slots } = builtinProgramRef.current

      if (layout === 'split') {
        const gap = 6
        const hw = (PROGRAM_W - gap) / 2
        drawCamInto(slots[0], 0, 0, hw, PROGRAM_H, 'cover')
        drawCamInto(slots[1], hw + gap, 0, hw, PROGRAM_H, 'cover')
      } else if (layout === 'pip') {
        drawCamInto(slots[0], 0, 0, PROGRAM_W, PROGRAM_H, 'contain')
        const iw = PROGRAM_W * 0.3
        const ih = (iw * 9) / 16
        const m = 48
        const ix = PROGRAM_W - iw - m
        const iy = PROGRAM_H - ih - m
        ctx.fillStyle = '#faa61a'
        ctx.fillRect(ix - 4, iy - 4, iw + 8, ih + 8)
        drawCamInto(slots[1], ix, iy, iw, ih, 'cover')
      } else {
        drawCamInto(slots[0], 0, 0, PROGRAM_W, PROGRAM_H, 'contain')
      }

      // CG overlay layers — composited over the program only (never ISO).
      const { layers, elements } = cgRef.current
      for (const layer of layers) {
        const el = elements.current.get(layer.id)
        if (!el) continue
        const notReady =
          el instanceof HTMLVideoElement ? el.readyState < 2
          : el instanceof HTMLImageElement ? (!el.complete || el.naturalWidth === 0)
          : false
        if (notReady) continue
        ctx.save()
        ctx.globalAlpha = layer.opacity
        ctx.globalCompositeOperation = layer.blend
        ctx.drawImage(el, 0, 0, PROGRAM_W, PROGRAM_H)
        ctx.restore()
      }
    }

    const drawBumper = () => {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, PROGRAM_W, PROGRAM_H)
      const bv = bumperVideoRef.current
      if (!bv || bv.readyState < 2 || bv.videoWidth === 0) return
      const scale = Math.min(PROGRAM_W / bv.videoWidth, PROGRAM_H / bv.videoHeight)
      const w = bv.videoWidth * scale
      const h = bv.videoHeight * scale
      ctx.drawImage(bv, (PROGRAM_W - w) / 2, (PROGRAM_H - h) / 2, w, h)
    }
    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (bumperRef.current) drawBumper()
      else renderProgram()

      const tr = activeTransitionRef.current
      if (!tr) return
      const p = (performance.now() - tr.startedAt) / tr.durationMs
      if (p >= 1) {
        activeTransitionRef.current = null
        return
      }
      if (tr.type === 'fade') {
        ctx.globalAlpha = 1 - p
        ctx.drawImage(prevCanvasRef.current!, 0, 0)
        ctx.globalAlpha = 1
      } else {
        if (p < 0.5) ctx.drawImage(prevCanvasRef.current!, 0, 0)
        ctx.fillStyle = `rgba(0,0,0,${(p < 0.5 ? p : 1 - p) * 2})`
        ctx.fillRect(0, 0, PROGRAM_W, PROGRAM_H)
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
      const camIdx = sourceKey.startsWith('cam') ? Number(sourceKey.slice(3)) : -1
      if (camIdx < 0) return
      const { layout } = builtinProgramRef.current
      const slot = activeSlotRef.current % SLOT_COUNT[layout]
      beginTransition()
      setBuiltinProgram(p => {
        const slots = p.slots.slice()
        slots[slot] = camIdx
        return { ...p, slots }
      })
      setActiveSlot((slot + 1) % SLOT_COUNT[layout])
    } else {
      const i = sourceKey.startsWith('cam') ? Number(sourceKey.slice(3)) : -1
      studio?.obsCut?.(i >= 0 ? OBS_SCENE_FOR_CAM[i] : sourceKey)
    }
  }, [engineId, beginTransition])

  const setLayout = useCallback((layout: LayoutType) => {
    beginTransition()
    setBuiltinProgram(p => {
      const count = SLOT_COUNT[layout]
      const slots = p.slots.slice(0, count)
      while (slots.length < count) {
        const used = new Set(slots)
        let cam = 0
        while (used.has(cam) && cam < 3) cam++
        slots.push(cam)
      }
      return { layout, slots }
    })
    setActiveSlot(0)
  }, [beginTransition])

  const rollBumper = useCallback((url: string, label: string) => {
    beginTransition()
    setBumper({ url, label })
  }, [beginTransition])

  const stopBumper = useCallback(() => {
    beginTransition()
    setBumper(null)
  }, [beginTransition])

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

  const obsCamIdx = OBS_SCENE_FOR_CAM.indexOf(obs.programScene)
  const value: EngineContextValue = {
    engineId,
    setEngineId,
    connected: engineId === 'builtin' ? true : obs.connected,
    programSource: engineId === 'builtin'
      ? `cam${builtinProgram.slots[0]}`
      : obsSceneToKey(obs.programScene),
    programCams: engineId === 'builtin'
      ? builtinProgram.slots
      : (obsCamIdx >= 0 ? [obsCamIdx] : []),
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
    transition,
    setTransition,
    layout: builtinProgram.layout,
    setLayout,
    programSlots: builtinProgram.slots,
    activeSlot,
    setActiveSlot,
    bumper,
    rollBumper,
    stopBumper,
    getProgramCanvas: () => masterCanvasRef.current,
    getProgramStream,
  }

  return (
    <Ctx.Provider value={value}>
      {bumper && (
        <div style={{ position: 'fixed', left: '-10000px', top: 0, pointerEvents: 'none' }} aria-hidden>
          <video
            ref={el => { bumperVideoRef.current = el; if (el) el.play().catch(() => {}) }}
            src={bumper.url}
            autoPlay playsInline
            width={160} height={90}
            onEnded={() => { beginTransition(); setBumper(null) }}
          />
        </div>
      )}
      {children}
    </Ctx.Provider>
  )
}

export function useEngine() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useEngine must be used within EngineProvider')
  return ctx
}
