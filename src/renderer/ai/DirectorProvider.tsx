import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useCameraStreams } from '../camera/CameraStreamProvider'
import { useViz } from '../viz/VizProvider'
import { useSceneAnalysis } from './SceneAnalysisProvider'
import { ActiveSpeakerDetector } from './activeSpeaker'
import { DEFAULT_STYLE_ID, getStyle } from './directorStyles'
import { type CameraRole, loadCameraRoles, saveCameraRoles, roleMeta } from './cameraRoles'

// Decision loop period. Fast enough to land cuts tight, slow enough to be cheap.
const TICK_MS = 140
// A program change within this long after a director cut is treated as its own.
const OWN_CUT_MS = 600
// A camera still counts as "populated" this long after its last detected face,
// so a brief detection dropout never reads an occupied chair as empty.
const POPULATED_GRACE_MS = 5000
// Auto-framing — target face height for a composed close-up, and the zoom loop
// gain / easing. The framer drives camera zoom so each shot is sized to its
// role; a poorly-centred subject is framed looser so the zoom never crops them.
const SHOT_CLOSEUP = 0.40
const ZOOM_GAIN = 1.6
const ZOOM_EASE = 0.16

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Whether the operator has AI auto-track enabled for a camera (it owns pan/tilt). */
function camTracked(index: number): boolean {
  try {
    const raw = localStorage.getItem('nar-tracking')
    if (raw) { const a = JSON.parse(raw); return Array.isArray(a) && !!a[index] }
  } catch { /* ignore */ }
  return false
}

/** 0..1 framing quality of a detected face — well-centred and sensibly sized. */
function framingScore(p: { cx: number; cy: number; size: number }): number {
  const offX = Math.min(1, Math.abs(p.cx - 0.5) / 0.34)
  const offY = Math.min(1, Math.abs(p.cy - 0.42) / 0.34)
  const centred = Math.max(0, 1 - (offX * 0.7 + offY * 0.3))
  const sz = p.size
  const sized = sz < 0.10 ? sz / 0.10
              : sz > 0.50 ? Math.max(0, (0.78 - sz) / 0.28)
              : 1
  return centred * sized
}

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
  /** Per-camera role — drives which camera the director picks and how it frames. */
  roles: CameraRole[]
  setRole: (index: number, role: CameraRole) => void
}

const Ctx = createContext<DirectorContextValue | null>(null)
const IDLE: DirectorStatus = { speaker: -1, confidence: 0, scores: [0, 0, 0, 0], action: 'Off' }

/**
 * The AI Director. It works out who is speaking by correlating each camera's
 * mouth motion against the studio audio, then cuts the program with a sense of
 * shot grammar — turn-change cuts, reaction shots, variety, pause-awareness —
 * tuned by the selected directing style and weighted by each camera's role.
 * It never cuts to a camera with no one in frame, frames every off-air shot to
 * its role, and a manual cut always overrides it.
 */
export function DirectorProvider({ children }: { children: ReactNode }) {
  const engine = useEngine()
  const engineRef = useRef(engine)
  engineRef.current = engine
  const viz = useViz()
  const vizRef = useRef(viz)
  vizRef.current = viz
  const { analysisRef } = useSceneAnalysis()
  const { streams } = useCameraStreams()
  const streamsRef = useRef(streams)
  streamsRef.current = streams

  const [enabled, setEnabledState] = useState(() => localStorage.getItem('nar-director') === 'on')
  const [styleId, setStyleIdState] = useState(() => localStorage.getItem('nar-director-style') || DEFAULT_STYLE_ID)
  const [status, setStatus] = useState<DirectorStatus>(IDLE)
  const [roles, setRolesState] = useState<CameraRole[]>(() => loadCameraRoles())

  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const styleRef = useRef(getStyle(styleId))
  styleRef.current = getStyle(styleId)
  const rolesRef = useRef(roles)
  rolesRef.current = roles

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

  const setRole = useCallback((index: number, role: CameraRole) => {
    setRolesState(prev => {
      const next = prev.slice()
      next[index] = role
      saveCameraRoles(next)
      return next
    })
  }, [])

  // Drive the cinematic letterbox from the active style (cleared when off).
  useEffect(() => {
    engineRef.current.setLetterbox(enabled ? getStyle(styleId).letterbox : 0)
  }, [enabled, styleId])

  useEffect(() => {
    const asd = new ActiveSpeakerDetector()
    const lastMouth = [0, 0, 0, 0]
    const lastPersonAt = [0, 0, 0, 0]   // Date.now() a person (face or body) was last seen

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

    // ── auto-framer state ────────────────────────────────────────────────────
    const frameBusy = [false, false, false, false]
    const frameSeen = [0, 0, 0, 0]   // analysis.updatedAt the framer last acted on

    /** A camera counts as populated for a grace window after its last person. */
    const populated = (i: number, now: number): boolean =>
      i >= 0 && i <= 3 && lastPersonAt[i] > 0 && now - lastPersonAt[i] < POPULATED_GRACE_MS

    /**
     * Pick a populated camera other than `exclude`, ranked by role weight and
     * framing quality, biased against cameras used recently. -1 if none.
     */
    const pickCamera = (exclude: number, now: number): number => {
      let best = -1
      let bestScore = -1
      for (let i = 0; i < 4; i++) {
        if (i === exclude || !populated(i, now)) continue
        const rm = roleMeta(rolesRef.current[i])
        const p = analysisRef.current[i]?.primary
        const fr = p ? framingScore(p) : 0.35
        let score = rm.weight + fr * 0.45 + Math.random() * 0.18
        if (recent.includes(i)) score -= 0.55
        if (score > bestScore) { bestScore = score; best = i }
      }
      return best
    }

    /** The best "home" camera — highest-weight populated role (the presenter). */
    const pickHome = (now: number): number => {
      let best = -1
      let bestScore = -1
      for (let i = 0; i < 4; i++) {
        if (!populated(i, now)) continue
        const rm = roleMeta(rolesRef.current[i])
        const p = analysisRef.current[i]?.primary
        const fr = p ? framingScore(p) : 0.35
        const score = rm.weight * 2 + fr
        if (score > bestScore) { bestScore = score; best = i }
      }
      return best
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

      // ── feed the speaker detector + track who is populated ─────────────────
      asd.pushAudio(now, vizRef.current.levelsRef.current.level)
      for (let i = 0; i < 4; i++) {
        const a = analysisRef.current[i]
        if (a && a.updatedAt !== lastMouth[i]) {
          lastMouth[i] = a.updatedAt
          asd.pushMouth(i, a.updatedAt, a.primary?.mouthOpen ?? 0, !!a.primary)
        }
        if (a && (a.faces.length > 0 || a.poses.length > 0)) lastPersonAt[i] = now
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
      // The confidence bar is eased for high-weight roles (it is cheap to trust
      // a presenter) and raised for low-weight ones (rarely call a wide "live").
      if (speaker >= 0 && speaker !== committed) {
        if (speaker !== candidate) { candidate = speaker; candidateSince = now }
        const rm = roleMeta(rolesRef.current[speaker])
        const confNeeded = style.speakerSwitchConfidence * (1.25 - 0.35 * rm.weight)
        if (confidence >= confNeeded && now - candidateSince >= style.speakerSwitchHold) {
          committed = speaker
          speakerSince = now
          candidate = -1
        }
      } else if (speaker === committed) {
        candidate = -1
      }

      // ── auto-frame off-air cameras — size each shot to its camera role ─────
      // Runs on cameras that are off air: the shot is composed and ready before
      // the director cuts to it. Zoom is driven from the *measured* face size,
      // so the framing is correct regardless of how far the subject sits.
      for (let i = 0; i < 4; i++) {
        if (eng.programSlots.includes(i) || frameBusy[i]) continue
        const a = analysisRef.current[i]
        if (!a?.primary || a.updatedAt === frameSeen[i]) continue   // act once per reading
        frameSeen[i] = a.updatedAt
        const track = streamsRef.current[i]?.getVideoTracks()[0]
        if (!track) continue
        const caps = (track.getCapabilities?.() ?? {}) as any
        if (!caps.zoom) continue
        const s = (track.getSettings?.() ?? {}) as any
        const role = rolesRef.current[i]
        const rm = roleMeta(role)
        // Resting size for the role; the speaker tightens to a close-up when the
        // style composes shots — but never on a 'wide' establishing camera.
        let targetSize = rm.shotSize
        if (style.shotComposition && i === committed && role !== 'wide') targetSize = SHOT_CLOSEUP
        // A poorly-centred subject is framed looser so the zoom never crops them
        // (the operator's AI Auto-Track recentres the camera if it is enabled).
        const off = Math.max(Math.abs(a.primary.cx - 0.5), Math.abs(a.primary.cy - 0.42))
        if (off > 0.20 && !camTracked(i)) targetSize = Math.min(targetSize, 0.22)
        const zr = caps.zoom.max - caps.zoom.min
        if (zr <= 0) continue
        const curZoom = typeof s.zoom === 'number' ? s.zoom : caps.zoom.min
        const err = clamp(targetSize - a.primary.size, -0.18, 0.18)
        if (Math.abs(err) < 0.03) continue                          // close enough — leave it
        const want = clamp(curZoom + err * ZOOM_GAIN * zr, caps.zoom.min, caps.zoom.max)
        const step = caps.zoom.step || 1
        const next = Math.round((curZoom + (want - curZoom) * ZOOM_EASE) / step) * step
        if (Math.abs(next - curZoom) < step) continue
        frameBusy[i] = true
        const adv: any = { zoom: next }
        track.applyConstraints({ advanced: [adv] as MediaTrackConstraintSet[] })
          .catch(() => {})
          .finally(() => { frameBusy[i] = false })
      }

      const publish = (action: string) =>
        setStatus({ speaker: committed, confidence, scores, action })

      // ── hold while a stream pre-roll owns the program ──────────────────────
      if (eng.prerollEndsAt != null) { publish('Stream pre-roll'); return }

      // ── reaction-shot hold ─────────────────────────────────────────────────
      if (reaction) {
        if (now < reaction.until) { publish('Reaction shot'); return }
        const back = reaction.back
        reaction = null
        // Only return to the speaker shot if it still has someone in it.
        let dest = back
        if (!populated(back, now)) { const h = pickHome(now); if (h >= 0) dest = h }
        doCut(dest, now)
        publish('Back to speaker')
        return
      }

      const elapsed = now - lastCutAt
      if (elapsed < style.minHold) { publish('Holding'); return }

      // ── recover from an empty shot — never sit on an empty chair ───────────
      if (curCam >= 0 && !populated(curCam, now)) {
        const home = committed >= 0 && populated(committed, now) ? committed : pickHome(now)
        if (home >= 0 && home !== curCam) {
          doCut(home, now)
          publish(`Empty shot — to CAM ${home + 1}`)
          return
        }
        publish('Holding — no one in frame')
        return
      }

      // ── cut to the speaker on a turn change ────────────────────────────────
      // Guarded by populated() so a lost face never pulls the program to a
      // camera the subject has already left.
      if (committed >= 0 && committed !== curCam && populated(committed, now)) {
        doCut(committed, now)
        publish(`Cut to speaker — CAM ${committed + 1}`)
        return
      }

      // ── already on the speaker: reaction shot during a long monologue ──────
      const monologue = committed >= 0 ? now - speakerSince : 0
      if (style.reactionShots && committed >= 0 && committed === curCam && monologue > style.reactionAfter) {
        const react = pickCamera(committed, now)
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
          const alt = pickCamera(curCam, now)
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
    <Ctx.Provider value={{ enabled, setEnabled, styleId, setStyleId, status, roles, setRole }}>
      {children}
    </Ctx.Provider>
  )
}

export function useDirector() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDirector must be used within DirectorProvider')
  return ctx
}
