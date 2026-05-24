import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from 'react'
import { useViz } from '../viz/VizProvider'

const studio = (window as any).studio

/**
 * Renderer-side OSC bridge — when enabled, pumps the live viz metrics out
 * via the main-process UDP sender at ~30 Hz, plus discrete `/nar/beat`
 * events on every detected onset. The address schema is what the UE
 * companion project subscribes to:
 *
 *   /nar/bpm        float — current tempo
 *   /nar/bpmLocked  float — 1 if phase-locked, 0 if drifting
 *   /nar/level      float — perceptual loudness 0..1
 *   /nar/bass       float — low-band energy 0..1
 *   /nar/mid        float — mid-band energy 0..1
 *   /nar/treble     float — high-band energy 0..1
 *   /nar/centroid   float — spectral centroid (perceived brightness) 0..1
 *   /nar/beatPhase  float — sawtooth 0..1 through the current beat
 *   /nar/lufs       float — momentary K-weighted loudness, LU
 *   /nar/beat       int   — incremented once per onset (use as event)
 */
export interface OscStatus {
  enabled: boolean
  host: string
  port: number
  rate: number
  lastError: string | null
}

interface OscCtx {
  status: OscStatus | null
  setEnabled: (on: boolean) => Promise<void>
  setHost: (host: string) => Promise<void>
  setPort: (port: number) => Promise<void>
}

const Ctx = createContext<OscCtx | null>(null)

const METRIC_HZ = 30
const METRIC_INTERVAL_MS = 1000 / METRIC_HZ

export function OscBridgeProvider({ children }: { children: ReactNode }) {
  const { levelsRef } = useViz()
  const [status, setStatus] = useState<OscStatus | null>(null)

  const refresh = useCallback(async () => {
    try {
      const s = await studio?.oscStatus?.()
      if (s) setStatus(s)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    refresh()
    const id = window.setInterval(refresh, 2000)
    return () => window.clearInterval(id)
  }, [refresh])

  // Pump metrics + beat events. The interval/effect only runs when enabled,
  // so it's free when the operator hasn't opted into external routing.
  const lastBeatAtRef = useRef(0)
  useEffect(() => {
    if (!status?.enabled) return
    const send = () => {
      const l = levelsRef.current
      // Round to 4 decimals before transmit — the wire is 32-bit float, but
      // this caps the noise floor visible in receivers' inspectors.
      const q = (n: number) => Math.round(n * 10000) / 10000
      studio?.oscSendMetrics?.({
        '/nar/bpm': q(l.bpm),
        '/nar/bpmLocked': l.bpmConfident ? 1 : 0,
        '/nar/level': q(l.level),
        '/nar/bass': q(l.bass),
        '/nar/mid': q(l.mid),
        '/nar/treble': q(l.treble),
        '/nar/centroid': q(l.centroid),
        '/nar/beatPhase': q(l.beatPhase),
        '/nar/lufs': q(l.lufs),
      })
      // Discrete onset event — fires once per beat detection.
      if (l.beatAt && l.beatAt !== lastBeatAtRef.current) {
        lastBeatAtRef.current = l.beatAt
        studio?.oscSendEvent?.('/nar/beat', Math.floor(l.beatAt * 1000) | 0)
      }
    }
    const id = window.setInterval(send, METRIC_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [status?.enabled, levelsRef])

  const setEnabled = useCallback(async (on: boolean) => {
    await studio?.oscSetEnabled?.(on)
    await refresh()
  }, [refresh])
  const setHost = useCallback(async (host: string) => {
    await studio?.oscSetHost?.(host)
    await refresh()
  }, [refresh])
  const setPort = useCallback(async (port: number) => {
    await studio?.oscSetPort?.(port)
    await refresh()
  }, [refresh])

  return (
    <Ctx.Provider value={{ status, setEnabled, setHost, setPort }}>
      {children}
    </Ctx.Provider>
  )
}

export function useOsc() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useOsc must be used inside OscBridgeProvider')
  return ctx
}
