import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useCameraStreams } from '../camera/CameraStreamProvider'
import { useEngine } from '../engine/EngineProvider'
import { useSceneAnalysis } from './SceneAnalysisProvider'

// Per-camera auto-tracking: nudges UVC pan/tilt to keep the detected subject
// framed. The control loop runs fast and *eases* the camera toward the target
// so the motion glides instead of snapping:
//   • the subject position is low-pass filtered (detection is jittery)
//   • a new target is computed only on a fresh detection (no stale re-applies)
//   • the command position eases a fraction of the way each tick
//   • the deadzone has a soft ramp so corrections fade in, never kick
const TICK_MS = 120        // control loop period — matches the manual-move rate
const CORRECTION = 0.3     // framing error → pan/tilt target offset
const EASE = 0.2           // fraction of the remaining distance moved per tick
const POS_SMOOTH = 0.55    // EMA weight kept from the previous subject position
const DEADZONE = 0.06      // framing error below this needs no correction
const SOFT_RAMP = 0.1      // error band over which the correction eases in
const TARGET_Y = 0.45      // frame the face slightly above centre

interface AiTrackingContextValue {
  tracking: boolean[]
  setTracking: (index: number, on: boolean) => void
}

const Ctx = createContext<AiTrackingContextValue | null>(null)

function loadTracking(): boolean[] {
  try {
    const raw = localStorage.getItem('nar-tracking')
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return [0, 1, 2, 3].map(i => !!arr[i])
    }
  } catch {}
  return [false, false, false, false]
}

function camInvertPan(index: number): boolean {
  try {
    const raw = localStorage.getItem(`nar-cam${index}`)
    if (raw) return !!JSON.parse(raw).invertPan
  } catch {}
  return false
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** 0 inside the deadzone, smoothly ramping to 1 — stops the camera kicking. */
function softGain(error: number): number {
  const t = clamp((error - DEADZONE) / SOFT_RAMP, 0, 1)
  return t * t * (3 - 2 * t)
}

export function AiTrackingProvider({ children }: { children: ReactNode }) {
  const { streams } = useCameraStreams()
  const { analysisRef } = useSceneAnalysis()
  const [tracking, setTrackingState] = useState<boolean[]>(() => loadTracking())

  const trackingRef = useRef(tracking)
  trackingRef.current = tracking
  const streamsRef = useRef(streams)
  streamsRef.current = streams
  // Which cameras are live on the program — tracking pauses on these so an
  // on-air shot never drifts or bounces under the viewer.
  const { programCams } = useEngine()
  const programCamsRef = useRef(programCams)
  programCamsRef.current = programCams

  const setTracking = useCallback((index: number, on: boolean) => {
    setTrackingState(prev => {
      const next = prev.slice()
      next[index] = on
      localStorage.setItem('nar-tracking', JSON.stringify(next))
      return next
    })
  }, [])

  // Control loop — for each tracked camera, ease pan/tilt toward the subject.
  useEffect(() => {
    const busy = [false, false, false, false]
    const lastSeen = [0, 0, 0, 0]                            // analysis.updatedAt acted on
    const subjX: (number | null)[] = [null, null, null, null] // smoothed subject position
    const subjY: (number | null)[] = [null, null, null, null]
    const cmdPan: (number | null)[] = [null, null, null, null] // eased command position
    const cmdTilt: (number | null)[] = [null, null, null, null]
    const tgtPan: (number | null)[] = [null, null, null, null] // target the command eases to
    const tgtTilt: (number | null)[] = [null, null, null, null]
    const appliedPan = [NaN, NaN, NaN, NaN]
    const appliedTilt = [NaN, NaN, NaN, NaN]

    const timer = setInterval(() => {
      for (let i = 0; i < 4; i++) {
        // A camera that is untracked — or live on the program — is left alone.
        // Tracking only reframes OFF-AIR cameras, so an on-air shot never
        // wanders or bounces; it resumes cleanly once the camera cuts away.
        if (!trackingRef.current[i] || programCamsRef.current.includes(i)) {
          // Drop all state so tracking starts clean when it resumes.
          subjX[i] = null; subjY[i] = null
          cmdPan[i] = null; cmdTilt[i] = null
          tgtPan[i] = null; tgtTilt[i] = null
          lastSeen[i] = 0
          appliedPan[i] = NaN; appliedTilt[i] = NaN
          continue
        }
        if (busy[i]) continue

        const track = streamsRef.current[i]?.getVideoTracks()[0]
        if (!track) continue
        const caps = (track.getCapabilities?.() ?? {}) as any
        if (!caps.pan || !caps.tilt) continue
        const s = (track.getSettings?.() ?? {}) as any

        let cp = cmdPan[i] ?? (s.pan ?? 0)
        let ct = cmdTilt[i] ?? (s.tilt ?? 0)

        // Recompute the target only on a fresh detection — acting on the same
        // (stale) reading twice is what made the old loop overshoot.
        const a = analysisRef.current[i]
        if (a?.primary && a.updatedAt !== lastSeen[i]) {
          lastSeen[i] = a.updatedAt
          // Resync to the camera's real position (catches manual nudges).
          if (typeof s.pan === 'number') cp = s.pan
          if (typeof s.tilt === 'number') ct = s.tilt
          // Low-pass the subject position to take the jitter out of detection.
          const px = subjX[i]
          const py = subjY[i]
          const sx = px == null ? a.primary.cx : px * POS_SMOOTH + a.primary.cx * (1 - POS_SMOOTH)
          const sy = py == null ? a.primary.cy : py * POS_SMOOTH + a.primary.cy * (1 - POS_SMOOTH)
          subjX[i] = sx
          subjY[i] = sy
          const ex = sx - 0.5
          const ey = sy - TARGET_Y
          const panDir = camInvertPan(i) ? -1 : 1
          tgtPan[i] = clamp(
            cp + ex * (caps.pan.max - caps.pan.min) * CORRECTION * softGain(Math.abs(ex)) * panDir,
            caps.pan.min, caps.pan.max,
          )
          tgtTilt[i] = clamp(
            ct - ey * (caps.tilt.max - caps.tilt.min) * CORRECTION * softGain(Math.abs(ey)),
            caps.tilt.min, caps.tilt.max,
          )
        }

        const tp = tgtPan[i]
        const tt = tgtTilt[i]
        if (tp == null || tt == null) {
          cmdPan[i] = cp
          cmdTilt[i] = ct
          continue
        }

        // Ease the command toward the target — the easing is what removes the
        // harshness: the camera decelerates into frame instead of snapping.
        cp += (tp - cp) * EASE
        ct += (tt - ct) * EASE
        cmdPan[i] = cp
        cmdTilt[i] = ct

        const panStep = caps.pan.step || 1
        const tiltStep = caps.tilt.step || 1
        const pan = Math.round(cp / panStep) * panStep
        const tilt = Math.round(ct / tiltStep) * tiltStep

        // Settled — skip the apply so the camera isn't spammed with no-ops.
        if (pan === appliedPan[i] && tilt === appliedTilt[i]) continue
        appliedPan[i] = pan
        appliedTilt[i] = tilt

        busy[i] = true
        const adv: any = { pan, tilt }
        track.applyConstraints({ advanced: [adv] as MediaTrackConstraintSet[] })
          .catch(() => {})
          .finally(() => { busy[i] = false })
      }
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [])

  return <Ctx.Provider value={{ tracking, setTracking }}>{children}</Ctx.Provider>
}

export function useAiTracking() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAiTracking must be used within AiTrackingProvider')
  return ctx
}
