import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useCameraStreams } from '../camera/CameraStreamProvider'
import { useCG } from '../cg/CGProvider'
import { isTakeoverTemplate, takeoverTransition } from '../cg/titles'
import { useViz, useVizActive } from '../viz/VizProvider'
import { useGrade } from '../grade/GradeProvider'
import { useSegmentation } from '../segmentation/SegmentationProvider'
import { useSceneAnalysis } from '../ai/SceneAnalysisProvider'
import { useBuiltinRecorder, type RecordingShow } from './useBuiltinRecorder'
import { useBuiltinStreamer, type StreamStatus, type StreamStats } from './useBuiltinStreamer'
import { useSchedule } from '../hooks/useSchedule'
import { useBroadcastAudio } from '../audio/BroadcastAudioProvider'
import { SLOT_COUNT, VIZ_SLOT, type EngineId, type EngineSource, type TransitionType, type LayoutType } from './types'

const studio = (window as any).studio

const PROGRAM_W = 1920
const PROGRAM_H = 1080
const OBS_SCENE_FOR_CAM = ['CAM1', 'CAM2', 'CAM3', 'CAM4']

// CG layer entrance / exit animation lengths (ms). LAYER_OUT_MS is kept in
// step with CGProvider's LAYER_EXIT_MS so a layer animates fully before prune.
const LAYER_IN_MS = 480
const LAYER_OUT_MS = 380

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
  /** Stream health — idle / live / reconnecting after an RTMP drop / lost. */
  streamStatus: StreamStatus
  recordTimecode: string | null
  streamTimecode: string | null
  recordingStartedAt: number | null
  recordingFile: string | null
  /** A disk-write failure during recording (disk full, permissions), else null. */
  recordError: string | null
  startRecording: (show: RecordingShow | null) => Promise<void>
  stopRecording: () => void
  autoRecord: boolean
  setAutoRecord: (on: boolean) => void
  /** Whether a clean ISO file is recorded per camera alongside the program. */
  recordIso: boolean
  setRecordIso: (on: boolean) => void
  /** Number of ISO camera files in the active recording. */
  isoCount: number
  streamStartedAt: number | null
  /** Encoder health from FFmpeg's progress lines, null when not streaming. */
  streamStats: StreamStats | null
  startStream: (rtmpUrl: string, streamKey: string) => Promise<void>
  stopStream: () => void
  /** Play a visualizer pre-roll when a stream starts, before cutting to cameras. */
  prerollEnabled: boolean
  setPrerollEnabled: (on: boolean) => void
  /** Pre-roll length in seconds. */
  prerollSeconds: number
  setPrerollSeconds: (s: number) => void
  /** Epoch ms the active pre-roll ends, or null when no pre-roll is running. */
  prerollEndsAt: number | null
  /** End the pre-roll now and cut straight to the live program. */
  skipPreroll: () => void
  cut: (sourceKey: string, transition?: TransitionType) => void
  transition: TransitionType
  setTransition: (t: TransitionType) => void
  /** Cinematic letterbox matte — aspect ratio (e.g. 2.39), 0 = off. */
  letterbox: number
  setLetterbox: (aspect: number) => void
  /** Beat-pulse vignette + punch-zoom treatment on the program output. */
  beatFx: boolean
  setBeatFx: (on: boolean) => void
  /** Autopilot: cut between cameras on the beat. Manual cuts always override. */
  autoVj: boolean
  setAutoVj: (on: boolean) => void
  /** Minimum seconds an Auto-VJ shot holds before the next beat cut. */
  autoVjHold: number
  setAutoVjHold: (s: number) => void
  /** Let the Auto-VJ director cut to the music visualizer, not just cameras. */
  autoVjViz: boolean
  setAutoVjViz: (on: boolean) => void
  /** Let the director choose split / PiP layouts when 2+ cameras have people. */
  autoVjLayouts: boolean
  setAutoVjLayouts: (on: boolean) => void
  /** Auto-swap to the visualizer when the track drops, back when it calms. */
  dropToViz: boolean
  setDropToViz: (on: boolean) => void
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
  const viz = useViz()
  const vizRef = useRef(viz)
  vizRef.current = viz
  const grade = useGrade()
  const gradeRef = useRef(grade)
  gradeRef.current = grade
  const seg = useSegmentation()
  const segRef = useRef(seg)
  segRef.current = seg
  const { analysisRef } = useSceneAnalysis()
  const camSourcesRef = useRef(camSources)
  camSourcesRef.current = camSources

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
  // Layout + last operator-intended source persist so a restart doesn't snap
  // back to solo + CAM1. We intentionally don't restore the *on-air* state
  // (that would silently put a stale source back on the program canvas);
  // instead we restore the *layout* + a hint of what the operator was using.
  const [builtinProgram, setBuiltinProgram] = useState<BuiltinProgram>(() => {
    try {
      const layoutRaw = localStorage.getItem('nar-program-layout') as LayoutType | null
      const slotsRaw = localStorage.getItem('nar-program-slots')
      const layout: LayoutType = (layoutRaw === 'solo' || layoutRaw === 'split' || layoutRaw === 'pip') ? layoutRaw : 'solo'
      const want = SLOT_COUNT[layout]
      let slots: number[] = [0]
      if (slotsRaw) {
        const arr = JSON.parse(slotsRaw)
        if (Array.isArray(arr) && arr.length === want && arr.every(n => typeof n === 'number')) slots = arr
      }
      // Pad / trim to the layout's slot count, defaulting any missing to CAM1.
      while (slots.length < want) slots.push(0)
      slots = slots.slice(0, want)
      return { layout, slots }
    } catch {
      return { layout: 'solo', slots: [0] }
    }
  })
  const builtinProgramRef = useRef(builtinProgram)
  builtinProgramRef.current = builtinProgram
  // Persist on every change. setBuiltinProgram is called from a dozen sites
  // (operator click, AI director, keyboard shortcut, viz cut, etc), so the
  // single effect is the simplest robust hook.
  useEffect(() => {
    try {
      localStorage.setItem('nar-program-layout', builtinProgram.layout)
      localStorage.setItem('nar-program-slots', JSON.stringify(builtinProgram.slots))
    } catch { /* ignore */ }
  }, [builtinProgram.layout, builtinProgram.slots])

  // Keep the visualizer rendering while it is live in the program.
  useVizActive(builtinProgram.slots.includes(VIZ_SLOT))

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
  const activeTransitionRef = useRef<{ effect: 'fade' | 'dip' | 'flash'; startedAt: number; durationMs: number } | null>(null)

  // Cinematic letterbox — aspect ratio of the matte (0 = off). Director-driven.
  const [letterbox, setLetterboxState] = useState(0)
  const letterboxRef = useRef(0)
  letterboxRef.current = letterbox
  const setLetterbox = useCallback((aspect: number) => setLetterboxState(aspect), [])

  // ── Audio-reactive switching & FX ─────────────────────────────────────────
  const [beatFx, setBeatFxState] = useState(() => localStorage.getItem('nar-beat-fx') === 'on')
  const beatFxRef = useRef(beatFx)
  beatFxRef.current = beatFx
  const setBeatFx = useCallback((on: boolean) => {
    localStorage.setItem('nar-beat-fx', on ? 'on' : 'off')
    setBeatFxState(on)
  }, [])

  const [autoVj, setAutoVjState] = useState(() => localStorage.getItem('nar-auto-vj') === 'on')
  const setAutoVj = useCallback((on: boolean) => {
    localStorage.setItem('nar-auto-vj', on ? 'on' : 'off')
    setAutoVjState(on)
  }, [])
  const [autoVjHold, setAutoVjHoldState] = useState(() => {
    const v = Number(localStorage.getItem('nar-auto-vj-hold'))
    return v >= 0.8 && v <= 6 ? v : 2.4
  })
  const setAutoVjHold = useCallback((s: number) => {
    localStorage.setItem('nar-auto-vj-hold', String(s))
    setAutoVjHoldState(s)
  }, [])
  const [autoVjViz, setAutoVjVizState] = useState(() => localStorage.getItem('nar-auto-vj-viz') === 'on')
  const autoVjVizRef = useRef(autoVjViz)
  autoVjVizRef.current = autoVjViz
  const setAutoVjViz = useCallback((on: boolean) => {
    localStorage.setItem('nar-auto-vj-viz', on ? 'on' : 'off')
    setAutoVjVizState(on)
  }, [])
  const [autoVjLayouts, setAutoVjLayoutsState] = useState(() => localStorage.getItem('nar-auto-vj-layouts') === 'on')
  const autoVjLayoutsRef = useRef(autoVjLayouts)
  autoVjLayoutsRef.current = autoVjLayouts
  const setAutoVjLayouts = useCallback((on: boolean) => {
    localStorage.setItem('nar-auto-vj-layouts', on ? 'on' : 'off')
    setAutoVjLayoutsState(on)
  }, [])

  const [dropToViz, setDropToVizState] = useState(() => localStorage.getItem('nar-drop-viz') === 'on')
  const setDropToViz = useCallback((on: boolean) => {
    localStorage.setItem('nar-drop-viz', on ? 'on' : 'off')
    setDropToVizState(on)
  }, [])

  // Director timing — shared between the manual cut() and the auto-director loop.
  const autoLastCutRef = useRef(0)
  const dropStateRef = useRef<{
    active: boolean
    returnProgram: BuiltinProgram | null
    hotSince: number
    coldSince: number
  }>({ active: false, returnProgram: null, hotSince: 0, coldSince: 0 })

  // Bumper / ad-break — a full-screen video that takes over the program.
  const [bumper, setBumper] = useState<{ url: string; label: string } | null>(null)
  const bumperRef = useRef(bumper)
  bumperRef.current = bumper
  const bumperVideoRef = useRef<HTMLVideoElement | null>(null)

  // ── Stream pre-roll — an optional visualizer intro shown when the stream
  // goes live, before the program cuts to the cameras.
  const [prerollEnabled, setPrerollEnabledState] = useState(() => localStorage.getItem('nar-preroll') === 'on')
  const prerollEnabledRef = useRef(prerollEnabled)
  prerollEnabledRef.current = prerollEnabled
  const setPrerollEnabled = useCallback((on: boolean) => {
    localStorage.setItem('nar-preroll', on ? 'on' : 'off')
    setPrerollEnabledState(on)
  }, [])
  const [prerollSeconds, setPrerollSecondsState] = useState(() => {
    const v = Number(localStorage.getItem('nar-preroll-secs'))
    return v >= 10 && v <= 300 ? v : 60
  })
  const prerollSecondsRef = useRef(prerollSeconds)
  prerollSecondsRef.current = prerollSeconds
  const setPrerollSeconds = useCallback((s: number) => {
    const v = Math.min(300, Math.max(10, Math.round(s)))
    localStorage.setItem('nar-preroll-secs', String(v))
    setPrerollSecondsState(v)
  }, [])
  const [prerollEndsAt, setPrerollEndsAt] = useState<number | null>(null)
  const prerollEndsAtRef = useRef(prerollEndsAt)
  prerollEndsAtRef.current = prerollEndsAt
  const prerollReturnRef = useRef<BuiltinProgram | null>(null)
  const prerollTimerRef = useRef<number | null>(null)

  const masterCanvasRef = useRef<HTMLCanvasElement | null>(null)
  if (!masterCanvasRef.current) masterCanvasRef.current = makeCanvas()
  const prevCanvasRef = useRef<HTMLCanvasElement | null>(null)
  if (!prevCanvasRef.current) prevCanvasRef.current = makeCanvas()
  const programStreamRef = useRef<MediaStream | null>(null)

  /**
   * Snapshot the current program frame and arm a transition (no-op for hard
   * cut). In 'reactive' mode the effect is chosen from the audio at cut time:
   * a hard beat gets a flash, a loud passage a quick fade, quiet a slow dissolve.
   */
  const beginTransition = useCallback((override?: TransitionType) => {
    const mode = override ?? transitionRef.current
    if (mode === 'cut') return
    let effect: 'fade' | 'dip' | 'flash'
    let durationMs: number
    if (mode === 'reactive') {
      const lv = vizRef.current.levelsRef.current
      if (lv.beat > 0.45) { effect = 'flash'; durationMs = 260 }
      else if (lv.level > 0.32) { effect = 'fade'; durationMs = 230 }
      else { effect = 'fade'; durationMs = 560 }
    } else {
      effect = mode
      durationMs = mode === 'dip' ? 700 : 450
    }
    const master = masterCanvasRef.current
    const prev = prevCanvasRef.current
    if (master && prev) {
      const pctx = prev.getContext('2d')!
      pctx.clearRect(0, 0, PROGRAM_W, PROGRAM_H)
      pctx.drawImage(master, 0, 0)
    }
    activeTransitionRef.current = { effect, startedAt: performance.now(), durationMs }
  }, [])

  // ── Pre-roll control ───────────────────────────────────────────────────────
  /** End the pre-roll and restore the program it interrupted. */
  const endPreroll = useCallback(() => {
    if (prerollTimerRef.current != null) { clearTimeout(prerollTimerRef.current); prerollTimerRef.current = null }
    const back = prerollReturnRef.current
    prerollReturnRef.current = null
    setPrerollEndsAt(null)
    if (back) {
      beginTransition()
      setBuiltinProgram(back)
      setActiveSlot(0)
    }
  }, [beginTransition])

  /** Drop the pre-roll without restoring — used when the operator cuts manually. */
  const cancelPreroll = useCallback(() => {
    if (prerollTimerRef.current != null) { clearTimeout(prerollTimerRef.current); prerollTimerRef.current = null }
    prerollReturnRef.current = null
    if (prerollEndsAtRef.current != null) setPrerollEndsAt(null)
  }, [])

  /** Take the program to the visualizer for `prerollSeconds`, then restore it. */
  const beginPreroll = useCallback(() => {
    const secs = prerollSecondsRef.current
    prerollReturnRef.current = builtinProgramRef.current
    beginTransition()
    setBuiltinProgram({ layout: 'solo', slots: [VIZ_SLOT] })
    setActiveSlot(0)
    setPrerollEndsAt(Date.now() + secs * 1000)
    if (prerollTimerRef.current != null) clearTimeout(prerollTimerRef.current)
    prerollTimerRef.current = window.setTimeout(endPreroll, secs * 1000)
  }, [beginTransition, endPreroll])

  // Compositor loop — renders the program layout + CG, with snapshot transitions.
  useEffect(() => {
    if (engineId !== 'builtin') return
    const canvas = masterCanvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0

    const drawCamInto = (
      camIdx: number, dx: number, dy: number, dw: number, dh: number, mode: 'cover' | 'contain',
    ) => {
      let src: CanvasImageSource
      let sw: number, sh: number
      if (camIdx === VIZ_SLOT) {
        const vc = vizRef.current.getCanvas()
        if (!vc) return
        src = vc; sw = vc.width; sh = vc.height
      } else {
        const v = camIdx >= 0 ? videoEls.current[camIdx] : null
        if (!v || v.readyState < 2 || v.videoWidth === 0) return
        // Colour grade (null when neutral), then live background segmentation
        // (null when the camera's background mode is off) — so an unprocessed
        // camera still draws its raw frame exactly as before.
        const graded = gradeRef.current.gradeFrame(camIdx, v)
        const segged = segRef.current.segmentFrame(camIdx, graded ?? v)
        if (segged) { src = segged; sw = segged.width; sh = segged.height }
        else if (graded) { src = graded; sw = graded.width; sh = graded.height }
        else { src = v; sw = v.videoWidth; sh = v.videoHeight }
      }
      const scale = mode === 'cover' ? Math.max(dw / sw, dh / sh) : Math.min(dw / sw, dh / sh)
      const w = sw * scale, h = sh * scale
      ctx.save()
      ctx.beginPath()
      ctx.rect(dx, dy, dw, dh)
      ctx.clip()
      ctx.drawImage(src, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h)
      ctx.restore()
    }

    // Beat-pulse treatment — a vignette + red edge bloom that breathes with
    // the music. Drawn at frame edges, after the (punch-scaled) program.
    const drawBeatFx = (beat: number, level: number) => {
      const cx = PROGRAM_W / 2, cy = PROGRAM_H / 2
      const vig = Math.min(0.82, 0.16 + beat * 0.42 + level * 0.10)
      const g1 = ctx.createRadialGradient(cx, cy, PROGRAM_H * 0.36, cx, cy, PROGRAM_H * 0.92)
      g1.addColorStop(0, 'rgba(0,0,0,0)')
      g1.addColorStop(1, `rgba(6,3,6,${vig})`)
      ctx.fillStyle = g1
      ctx.fillRect(0, 0, PROGRAM_W, PROGRAM_H)
      if (beat > 0.04) {
        ctx.save()
        ctx.globalCompositeOperation = 'screen'
        const g2 = ctx.createRadialGradient(cx, cy, PROGRAM_H * 0.52, cx, cy, PROGRAM_H)
        g2.addColorStop(0, 'rgba(0,0,0,0)')
        g2.addColorStop(1, `rgba(232,0,60,${beat * 0.30})`)
        ctx.fillStyle = g2
        ctx.fillRect(0, 0, PROGRAM_W, PROGRAM_H)
        ctx.restore()
      }
    }

    const renderProgram = () => {
      ctx.fillStyle = '#070708'
      ctx.fillRect(0, 0, PROGRAM_W, PROGRAM_H)

      const fx = beatFxRef.current ? vizRef.current.levelsRef.current : null

      ctx.save()
      if (fx && fx.beat > 0.002) {
        const z = 1 + fx.beat * 0.045   // micro punch-zoom on the beat
        ctx.translate(PROGRAM_W / 2, PROGRAM_H / 2)
        ctx.scale(z, z)
        ctx.translate(-PROGRAM_W / 2, -PROGRAM_H / 2)
      }

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
      // Overlays use a small slide-and-fade; full-screen takeover cards use
      // their own per-template transition recipe so each card enters and
      // leaves with intent (BRB zooms, Stand By flashes, Coming Up slides
      // editorial, On Air punches in).
      const { layers, elements } = cgRef.current
      const cgNow = performance.now()
      for (const layer of layers) {
        const el = elements.current.get(layer.id)
        if (!el) continue
        const notReady =
          el instanceof HTMLVideoElement ? el.readyState < 2
          : el instanceof HTMLImageElement ? (!el.complete || el.naturalWidth === 0)
          : false
        if (notReady) continue
        const pInRaw = Math.min(1, (cgNow - layer.addedAt) / LAYER_IN_MS)
        let pOutRaw = 0
        if (layer.removingAt != null) {
          pOutRaw = Math.min(1, (cgNow - layer.removingAt) / LAYER_OUT_MS)
        }

        const isTakeover = layer.kind === 'title' && isTakeoverTemplate(layer.template)
        if (isTakeover) {
          // Pull the per-template transform recipe. Each card defines its
          // own scale / translate / flash so they don't all enter the same.
          const t = takeoverTransition(layer.template!, pInRaw, pOutRaw)
          if (t.alpha <= 0.001) continue
          ctx.save()
          ctx.globalAlpha = layer.opacity * t.alpha
          ctx.globalCompositeOperation = layer.blend
          // Scale around the canvas centre + apply translate.
          const cx = PROGRAM_W / 2, cy = PROGRAM_H / 2
          ctx.translate(cx + t.dx, cy + t.dy)
          ctx.scale(t.scale, t.scale)
          ctx.drawImage(el, -PROGRAM_W / 2, -PROGRAM_H / 2, PROGRAM_W, PROGRAM_H)
          ctx.restore()
          // Optional white-flash overlay drawn at screen scale so the flash
          // isn't softened by the card's scale transform.
          if (t.flash > 0.002) {
            ctx.save()
            ctx.globalAlpha = layer.opacity * t.flash
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, PROGRAM_W, PROGRAM_H)
            ctx.restore()
          }
          continue
        }

        // Standard overlay transition (lower-thirds, clock, etc).
        const eIn = 1 - Math.pow(1 - pInRaw, 3)               // ease-out cubic
        const eOut = pOutRaw * pOutRaw                        // ease-in quad
        const vis = eIn * (1 - eOut)
        if (vis <= 0.001) continue
        const dy = (1 - eIn) * 54 + eOut * 40               // slide up in, down out
        ctx.save()
        ctx.globalAlpha = layer.opacity * vis
        ctx.globalCompositeOperation = layer.blend
        ctx.drawImage(el, 0, dy, PROGRAM_W, PROGRAM_H)
        ctx.restore()
      }

      ctx.restore()

      if (fx) drawBeatFx(fx.beat, fx.level)
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

      // Snapshot transition overlay.
      const tr = activeTransitionRef.current
      if (tr) {
        const p = (performance.now() - tr.startedAt) / tr.durationMs
        if (p >= 1) {
          activeTransitionRef.current = null
        } else if (tr.effect === 'fade') {
          ctx.globalAlpha = 1 - p
          ctx.drawImage(prevCanvasRef.current!, 0, 0)
          ctx.globalAlpha = 1
        } else if (tr.effect === 'dip') {
          if (p < 0.5) ctx.drawImage(prevCanvasRef.current!, 0, 0)
          ctx.fillStyle = `rgba(0,0,0,${(p < 0.5 ? p : 1 - p) * 2})`
          ctx.fillRect(0, 0, PROGRAM_W, PROGRAM_H)
        } else {
          // flash — RGB-split ghost of the outgoing frame + a white pop
          const g = 1 - p
          const prev = prevCanvasRef.current!
          ctx.save()
          ctx.globalCompositeOperation = 'screen'
          ctx.globalAlpha = g * 0.45
          const off = 22 * g
          ctx.drawImage(prev, off, 0)
          ctx.drawImage(prev, -off, 0)
          ctx.restore()
          ctx.fillStyle = `rgba(255,255,255,${g * g * 0.5})`
          ctx.fillRect(0, 0, PROGRAM_W, PROGRAM_H)
        }
      }

      // Cinematic letterbox — drawn last, over the program and any transition.
      const lb = letterboxRef.current
      if (lb > 1.78) {
        const barH = Math.round((PROGRAM_H - PROGRAM_W / lb) / 2)
        if (barH > 0) {
          ctx.fillStyle = '#000'
          ctx.fillRect(0, 0, PROGRAM_W, barH)
          ctx.fillRect(0, PROGRAM_H - barH, PROGRAM_W, barH)
        }
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [engineId, videoEls])

  // ── Unified surface ───────────────────────────────────────────────────────
  const camEngineSources: EngineSource[] = Array.from({ length: 4 }, (_, i) => {
    const cam = camSources.find(c => c.index === i)
    return {
      key: `cam${i}`,
      label: `CAM ${i + 1}`,
      hasSignal: cam?.hasSignal ?? false,
    }
  })
  // The visualizer is a built-in-engine source — peer to the four cameras.
  const sources: EngineSource[] = engineId === 'builtin'
    ? [...camEngineSources, { key: 'viz', label: 'Music Viz', hasSignal: true }]
    : camEngineSources

  const obsSceneToKey = (scene: string) => {
    const i = OBS_SCENE_FOR_CAM.indexOf(scene)
    return i >= 0 ? `cam${i}` : scene
  }

  /** Drop a source index into the active program slot — the shared cut primitive. */
  const applyCut = useCallback((srcIdx: number, transitionOverride?: TransitionType) => {
    const { layout } = builtinProgramRef.current
    const slot = activeSlotRef.current % SLOT_COUNT[layout]
    beginTransition(transitionOverride)
    setBuiltinProgram(p => {
      const slots = p.slots.slice()
      slots[slot] = srcIdx
      return { ...p, slots }
    })
    setActiveSlot((slot + 1) % SLOT_COUNT[layout])
  }, [beginTransition])

  const cut = useCallback((sourceKey: string, transitionOverride?: TransitionType) => {
    if (engineId === 'builtin') {
      let srcIdx: number
      if (sourceKey === 'viz') srcIdx = VIZ_SLOT
      else if (sourceKey.startsWith('cam')) srcIdx = Number(sourceKey.slice(3))
      else return
      applyCut(srcIdx, transitionOverride)
      // A manual cut is authoritative — reset the auto-cut clock, release any
      // drop-mode ownership, and end any pre-roll so nothing fights the operator.
      autoLastCutRef.current = performance.now()
      dropStateRef.current.active = false
      cancelPreroll()
    } else {
      if (sourceKey === 'viz') return
      const i = sourceKey.startsWith('cam') ? Number(sourceKey.slice(3)) : -1
      studio?.obsCut?.(i >= 0 ? OBS_SCENE_FOR_CAM[i] : sourceKey)
    }
  }, [engineId, applyCut, cancelPreroll])

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

  // Pull the processed broadcast stream from the audio provider — what the
  // operator's compressor and limiter actually shape. The streamer prefers
  // these tracks over a raw device capture so the on-air audio matches what
  // the AudioPanel meters show.
  const broadcastAudio = useBroadcastAudio()
  const broadcastAudioRef = useRef(broadcastAudio.processedStream)
  broadcastAudioRef.current = broadcastAudio.processedStream
  const getBroadcastAudio = useCallback(() => broadcastAudioRef.current, [])

  const builtinRec = useBuiltinRecorder(getProgramStream, getBroadcastAudio)
  const builtinStream = useBuiltinStreamer(getProgramStream, getBroadcastAudio)

  // Going live optionally runs a visualizer pre-roll before the program shows
  // the cameras; ending the stream clears any pre-roll in progress.
  const startStream = useCallback(async (rtmpUrl: string, streamKey: string) => {
    await builtinStream.start(rtmpUrl, streamKey)
    if (prerollEnabledRef.current) beginPreroll()
  }, [builtinStream.start, beginPreroll])

  const stopStream = useCallback(() => {
    builtinStream.stop()
    endPreroll()
  }, [builtinStream.stop, endPreroll])

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
      if ((e.key === 'v' || e.key === 'V') && engineId === 'builtin') { cut('viz'); return }
      if ((e.key === 'r' || e.key === 'R') && engineId === 'builtin') {
        if (builtinRec.recording) builtinRec.stop()
        else builtinRec.start(null).catch(err => console.error('[engine] record start failed:', err))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cut, engineId, builtinRec.recording, builtinRec.start, builtinRec.stop])

  // ── Auto-director — beat-cutting between cameras + cut-to-viz on the drop.
  // rAF-driven so beat cuts land tight. Any manual cut() overrides instantly.
  useEffect(() => {
    if (engineId !== 'builtin' || (!autoVj && !dropToViz)) return
    let raf = 0
    let lastBeatAt = 0

    // Next source to cut to — a signal-bearing camera that has a person in
    // frame so the montage never lands on an empty chair, or the music
    // visualizer. When no camera has anyone in it the visualizer carries the
    // show rather than cutting to an empty room. -1 = hold the current shot.
    const pickAutoSource = (): number => {
      const live = builtinProgramRef.current.slots
      const vizOk = autoVjVizRef.current && !live.includes(VIZ_SLOT)
      const signal = camSourcesRef.current.filter(c => c.hasSignal).map(c => c.index)
      let pool = signal.filter(i => !live.includes(i))
      if (pool.length === 0) pool = signal.filter(i => i !== live[0])
      // Only cameras with a detected person — never beat-cut to an empty chair.
      const withPeople = pool.filter(i => (analysisRef.current[i]?.people ?? 0) > 0)
      // ~a third of beat-cuts go to the visualizer; all of them when no camera
      // has anyone in frame.
      if (vizOk && (withPeople.length === 0 || Math.random() < 0.3)) return VIZ_SLOT
      if (withPeople.length === 0) return -1
      return withPeople[Math.floor(Math.random() * withPeople.length)]
    }

    // Director layout decision — mostly a solo shot, but occasionally a split
    // or PiP two-up, and only when 2+ different cameras each have someone in
    // frame so a pane is never an empty seat or a duplicate of the other.
    const directorLayoutCut = () => {
      const live = builtinProgramRef.current.slots
      const populated = camSourcesRef.current
        .filter(c => c.hasSignal && (analysisRef.current[c.index]?.people ?? 0) > 0)
        .map(c => c.index)

      if (populated.length >= 2 && Math.random() < 0.32) {
        const pool = populated.slice()
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          const t = pool[i]; pool[i] = pool[j]; pool[j] = t
        }
        let a = pool[0], b = pool[1]
        if (pool.length > 2 && live.includes(a) && live.includes(b)) b = pool[2]
        const layout: LayoutType = Math.random() < 0.5 ? 'split' : 'pip'
        beginTransition()
        setBuiltinProgram({ layout, slots: [a, b] })
        setActiveSlot(0)
        autoLastCutRef.current = performance.now()
        return
      }

      const next = pickAutoSource()
      if (next === -1) return
      beginTransition()
      setBuiltinProgram({ layout: 'solo', slots: [next] })
      setActiveSlot(0)
      autoLastCutRef.current = performance.now()
    }

    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (bumperRef.current) return            // never disturb a bumper / ad break
      if (prerollEndsAtRef.current != null) return   // hold during a stream pre-roll
      const lv = vizRef.current.levelsRef.current
      const now = performance.now()
      const ds = dropStateRef.current

      if (autoVj && !ds.active && lv.beatAt !== lastBeatAt) {
        lastBeatAt = lv.beatAt
        if (now - autoLastCutRef.current > autoVjHold * 1000) {
          if (autoVjLayoutsRef.current) {
            directorLayoutCut()
          } else {
            const next = pickAutoSource()
            if (next !== -1) {
              applyCut(next)
              autoLastCutRef.current = now
            }
          }
        }
      }

      if (dropToViz) {
        const hot = lv.level > 0.55 || lv.bass > 0.62
        const cold = lv.level < 0.40 && lv.bass < 0.45
        if (!ds.active) {
          ds.hotSince = hot ? (ds.hotSince || now) : 0
          if (ds.hotSince && now - ds.hotSince > 350) {
            ds.active = true
            ds.returnProgram = builtinProgramRef.current
            ds.hotSince = 0
            beginTransition()
            setBuiltinProgram({ layout: 'solo', slots: [VIZ_SLOT] })
          }
        } else {
          ds.coldSince = cold ? (ds.coldSince || now) : 0
          if (ds.coldSince && now - ds.coldSince > 1600) {
            const back = ds.returnProgram
            ds.active = false
            ds.coldSince = 0
            ds.returnProgram = null
            beginTransition()
            if (back) setBuiltinProgram(back)
          }
        }
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engineId, autoVj, dropToViz, autoVjHold, applyCut, beginTransition])

  const obsCamIdx = OBS_SCENE_FOR_CAM.indexOf(obs.programScene)
  const value: EngineContextValue = {
    engineId,
    setEngineId,
    connected: engineId === 'builtin' ? true : obs.connected,
    programSource: engineId === 'builtin'
      ? (builtinProgram.slots[0] === VIZ_SLOT ? 'viz' : `cam${builtinProgram.slots[0]}`)
      : obsSceneToKey(obs.programScene),
    programCams: engineId === 'builtin'
      ? builtinProgram.slots
      : (obsCamIdx >= 0 ? [obsCamIdx] : []),
    sources,
    obsScenes: obs.scenes,
    recording: engineId === 'builtin' ? builtinRec.recording : obs.recording,
    streaming: engineId === 'builtin' ? builtinStream.streaming : obs.streaming,
    streamStatus: engineId === 'builtin'
      ? builtinStream.status
      : (obs.streaming ? 'live' : 'idle'),
    recordTimecode: engineId === 'builtin' ? null : obs.recordTimecode,
    streamTimecode: engineId === 'builtin' ? null : obs.streamTimecode,
    recordingStartedAt: engineId === 'builtin' ? builtinRec.startedAt : null,
    recordingFile: engineId === 'builtin' ? builtinRec.filePath : null,
    recordError: engineId === 'builtin' ? builtinRec.recordError : null,
    startRecording: builtinRec.start,
    stopRecording: builtinRec.stop,
    autoRecord,
    setAutoRecord,
    recordIso: builtinRec.recordIso,
    setRecordIso: builtinRec.setRecordIso,
    isoCount: engineId === 'builtin' ? builtinRec.isoCount : 0,
    streamStartedAt: engineId === 'builtin' ? builtinStream.startedAt : null,
    streamStats: engineId === 'builtin' ? builtinStream.stats : null,
    startStream,
    stopStream,
    prerollEnabled,
    setPrerollEnabled,
    prerollSeconds,
    setPrerollSeconds,
    prerollEndsAt,
    skipPreroll: endPreroll,
    cut,
    transition,
    setTransition,
    letterbox,
    setLetterbox,
    beatFx,
    setBeatFx,
    autoVj,
    setAutoVj,
    autoVjHold,
    setAutoVjHold,
    autoVjViz,
    setAutoVjViz,
    autoVjLayouts,
    setAutoVjLayouts,
    dropToViz,
    setDropToViz,
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
