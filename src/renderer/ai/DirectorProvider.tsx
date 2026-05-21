import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useCameraStreams } from '../camera/CameraStreamProvider'
import { useViz } from '../viz/VizProvider'
import { useSceneAnalysis } from './SceneAnalysisProvider'
import { ActiveSpeakerDetector } from './activeSpeaker'
import { DEFAULT_STYLE_ID, getStyle } from './directorStyles'

// Decision loop period. Fast enough to land cuts tight, slow enough to be cheap.
const TICK_MS = 140
// A program change within this long after a director cut is treated as its own.
const OWN_CUT_MS = 600
// Shot composition — fraction of a camera's zoom range used per shot size, and
// how fast the zoom eases toward it each tick.
const CLOSE_FRAC = 0.5
const MEDIUM_FRAC = 0.18
const ZOOM_EASE = 0.15

export interface DirectorStatus {
  /** Active speaker camera index, or -1 when none is confident. */
  speaker: number
  /** Speaker confidence 0..1. */
  confidence: number
  /** Per-camera speaking score 0..1. */
  scores: number[]
  /** Human-readable description of what the director is doing. */
  action: string
}

interface DirectorContextValue {
  enabled: boolean
  setEnabled: (on: boolean) => void
  styleId: string
  setStyleId: (id: string) => void
  status: DirectorStatus
}

const Ctx = createContext<DirectorContextValue | null>(null)
const IDLE: DirectorStatus = { speaker: -1, confidence: 0, scores: [0, 0, 0, 0], action: 'Off' }

/**
 * The AI Director. It works out who is speaking by correlating each camera's
 * mouth motion against the studio audio, then cuts the program with a sense of
 * shot grammar — turn-change cuts, reaction shots, variety, pause-awareness —
 * tuned by the selected directing style. A manual cut always overrides it.
 */
export function DirectorProvider({ children }: { children: ReactNode }) {
  const engine = useEngine()
  const engineRef = useRef(engine)
  engineRef.current = engine
  const viz = useViz()
  const vizRef = useRef(viz)
  vizRef.current = viz
  const { analysis } = useSceneAnalysis()
  const analysisRef = useRef(analysis)
  analysisRef.current = analysis
  const { streams } = useCameraStreams()
  const streamsRef = useRef(streams)
  streamsRef.current = streams

  const [enabled, setEnabledState] = useState(() => localStorage.getItem('nar-director') === 'on')
  const [styleId, setStyleIdState] = useState(() => localStorage.getItem('nar-director-style') || DEFAULT_STYLE_ID)
  const [status, setStatus] = useState<DirectorStatus>(IDLE)

  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const styleRef = useRef(getStyle(styleId))
  styleRef.current = getStyle(styleId)

  const setEnabled = useCallback((on: boolean) => {
    localStorage.setItem('nar-director', on ? 'on' : 'off')
    setEnabledState(on)
    // The director and the music Auto-VJ are mutually exclusive directing modes.
    if (on) {
      engineRef.current.setAutoVj(false)
      engineRef.current.setDropToViz(false)
    }
  }, [])

  const setStyleId = useCallback((id: string) => {
    localStorage.setItem('nar-director-style', id)
    setStyleIdState(id)
  }, [])

  // Drive the cinematic letterbox from the active style (cleared when off).
  useEffect(() => {
    engineRef.current.setLetterbox(enabled ? getStyle(styleId).letterbox : 0)
  }, [enabled, styleId])

  useEffect(() => {
    const asd = new ActiveSpeakerDetector()
    const lastMouth = [0, 0, 0, 0]

    // ── director memory ──────────────────────────────────────────────────────
    let committed = -1          // speaker the director is committed to
    let speakerSince = 0
    let candidate = -1          // a contender for the speaker title
    let candidateSince = 0
    let lastCutAt = 0
    let directorCutAt = 0
    let progSig = ''
    let recent: number[] = []   // cameras cut to recently — for shot variety
    let reaction: { until: number; back: number } | null = null
    let wasActive = false
    const zoomBusy = [false, false, false, false]   // shot-composition apply guards

    /** A face camera other than `exclude`, preferring one not used recently. */
    const camWithFace = (exclude: number): number => {
      const faces: number[] = []
      for (let i = 0; i < 4; i++) {
        if (i !== exclude && analysisRef.current[i]?.primary) faces.push(i)
      }
      if (faces.length === 0) return -1
      const fresh = faces.filter(i => !recent.includes(i))
      return (fresh.length ? fresh : faces)[0]
    }

    const doCut = (cam: number, now: number) => {
      const txn = styleRef.current.transition
      engineRef.current.cut(`cam${cam}`, txn === 'auto' ? undefined : txn)
      lastCutAt = now
      directorCutAt = now
      recent.push(cam)
      if (recent.length > 3) recent.shift()
    }

    const timer = setInterval(() => {
      const now = Date.now()
      const eng = engineRef.current
      const style = styleRef.current

      // ── feed the speaker detector every tick ───────────────────────────────
      asd.pushAudio(now, vizRef.current.levelsRef.current.level)
      for (let i = 0; i < 4; i++) {
        const a = analysisRef.current[i]
        if (a && a.updatedAt !== lastMouth[i]) {
          lastMouth[i] = a.updatedAt
          asd.pushMouth(i, a.updatedAt, a.primary?.mouthOpen ?? 0, !!a.primary)
        }
      }
      const { speaker, confidence, scores } = asd.evaluate(now)

      if (!enabledRef.current || eng.engineId !== 'builtin') {
        if (wasActive) { wasActive = false; setStatus(IDLE) }
        return
      }
      if (!wasActive) {
        // Fresh enable — baseline to whatever is currently on air.
        wasActive = true
        committed = -1
        candidate = -1
        reaction = null
        recent = []
        lastCutAt = now
        directorCutAt = now
        progSig = eng.programSlots.join(',')
      }

      // ── manual-override detection ──────────────────────────────────────────
      const sig = eng.programSlots.join(',')
      if (sig !== progSig) {
        progSig = sig
        if (now - directorCutAt > OWN_CUT_MS) {
          // The operator cut — respect it and wait a full hold before acting.
          lastCutAt = now
          reaction = null
        }
      }

      const curCam = eng.programSlots[0]

      // ── speaker hysteresis — commit only to a sustained, confident lead ────
      if (speaker >= 0 && speaker !== committed) {
        if (speaker !== candidate) { candidate = speaker; candidateSince = now }
        if (confidence >= style.speakerSwitchConfidence && now - candidateSince >= style.speakerSwitchHold) {
          committed = speaker
          speakerSince = now
          candidate = -1
        }
      } else if (speaker === committed) {
        candidate = -1
      }

      // ── shot composition — compose shot sizes via zoom on off-air cameras ──
      // The speaker's camera is framed as a close-up, the rest as mediums, all
      // while off air so the shot is ready the moment the director cuts to it.
      if (style.shotComposition) {
        for (let i = 0; i < 4; i++) {
          if (eng.programSlots.includes(i) || zoomBusy[i]) continue
          const track = streamsRef.current[i]?.getVideoTracks()[0]
          if (!track) continue
          const caps = (track.getCapabilities?.() ?? {}) as any
          if (!caps.zoom) continue
          const frac = i === committed ? CLOSE_FRAC : MEDIUM_FRAC
          const target = caps.zoom.min + frac * (caps.zoom.max - caps.zoom.min)
          const s = (track.getSettings?.() ?? {}) as any
          const cur = typeof s.zoom === 'number' ? s.zoom : caps.zoom.min
          const step = caps.zoom.step || 1
          const next = Math.round((cur + (target - cur) * ZOOM_EASE) / step) * step
          if (Math.abs(next - cur) < step) continue
          zoomBusy[i] = true
          const adv: any = { zoom: next }
          track.applyConstraints({ advanced: [adv] as MediaTrackConstraintSet[] })
            .catch(() => {})
            .finally(() => { zoomBusy[i] = false })
        }
      }

      const publish = (action: string) =>
        setStatus({ speaker: committed, confidence, scores, action })

      // ── reaction-shot hold ─────────────────────────────────────────────────
      if (reaction) {
        if (now < reaction.until) { publish('Reaction shot'); return }
        const back = reaction.back
        reaction = null
        doCut(back, now)
        publish('Back to speaker')
        return
      }

      const elapsed = now - lastCutAt
      if (elapsed < style.minHold) { publish('Holding'); return }

      // ── cut to the speaker on a turn change ────────────────────────────────
      if (committed >= 0 && committed !== curCam) {
        doCut(committed, now)
        publish(`Cut to speaker — CAM ${committed + 1}`)
        return
      }

      // ── already on the speaker: reaction shot during a long monologue ──────
      const monologue = committed >= 0 ? now - speakerSince : 0
      if (style.reactionShots && committed >= 0 && committed === curCam && monologue > style.reactionAfter) {
        const react = camWithFace(committed)
        if (react >= 0) {
          reaction = { until: now + style.reactionHold, back: curCam }
          doCut(react, now)
          publish('Reaction shot')
          return
        }
      }

      // ── max-hold variety, held back until a conversational pause ───────────
      if (elapsed > style.maxHold) {
        const loud = vizRef.current.levelsRef.current.level > 0.22
        const overdue = elapsed > style.maxHold * (1 + style.pauseBias * 0.6)
        if (!loud || overdue) {
          const alt = camWithFace(curCam)
          if (alt >= 0) {
            doCut(alt, now)
            publish(`New angle — CAM ${alt + 1}`)
            return
          }
        }
        publish('Holding — waiting for a pause')
        return
      }

      publish(committed >= 0 ? `On speaker — CAM ${committed + 1}` : 'Holding — listening')
    }, TICK_MS)

    return () => clearInterval(timer)
  }, [])

  return (
    <Ctx.Provider value={{ enabled, setEnabled, styleId, setStyleId, status }}>
      {children}
    </Ctx.Provider>
  )
}

export function useDirector() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDirector must be used within DirectorProvider')
  return ctx
}
