/**
 * Renderer-side mirror of the main-process Myriad UDP bridge.
 *
 * Owns:
 *   • a snapshot of the bridge's status (`studio.myriadStatus()`)
 *   • a rolling log of the last N parsed events (for the inspector UI)
 *   • the most-recent raw packet text (for debugging mis-configured macros)
 *   • thin async wrappers around the IPC setters
 *
 * Intentionally does NOT bind events to NAR actions yet. The future commit
 * that adds `applyMyriadEvent` (see ShowsProvider's comment block) will live
 * in its own consumer hook — e.g. a `useMyriadActionBinder()` mounted next
 * to ShowsProvider that subscribes to `events` and calls
 * `shows.applyShowByName(e.name)` / `bumpers.fireByName(e.name)`. Keeping
 * receive + bind separate means the inspector keeps working when the binding
 * is wrong / disabled.
 *
 * Mount this provider inside any subtree that needs to react to Myriad
 * triggers — for now, "near the bottom of the App tree" is fine; it just
 * needs to be inside `ShowsProvider` once the binding hook arrives.
 */
import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from 'react'
import type { MyriadEvent } from '../shows/types'

const studio = (window as any).studio as {
  myriadStatus: () => Promise<MyriadStatus>
  myriadSetEnabled: (enabled: boolean) => Promise<void>
  myriadSetPort: (port: number) => Promise<void>
  myriadSetHost: (host: string) => Promise<void>
  onMyriadEvent: (cb: (e: MyriadEvent) => void) => () => void
  onMyriadRaw: (cb: (s: string) => void) => () => void
}

export interface MyriadStatus {
  enabled: boolean
  listening: boolean
  port: number
  bindHost: string
  messagesReceived: number
  eventsParsed: number
  parseErrors: number
  lastEventAt: number | null
}

/** Rolling-log entry — the original event plus the local receipt time. */
export interface MyriadLogEntry {
  event: MyriadEvent
  /** Renderer wall-clock ms when the event landed in this provider. */
  receivedAt: number
}

interface MyriadCtx {
  status: MyriadStatus | null
  /** Most-recent first; capped at MAX_LOG entries. */
  events: MyriadLogEntry[]
  /** Last raw UDP payload (latin1, clipped to 256 chars by main). */
  lastRaw: string | null
  setEnabled: (on: boolean) => Promise<void>
  setPort: (p: number) => Promise<void>
  setHost: (h: string) => Promise<void>
  /** Pull a fresh status snapshot from main (e.g. after the operator changes
   *  a field — restart is async so stats may have moved). */
  refresh: () => Promise<void>
  /** Drop the inspector log without changing main-process state. */
  clearLog: () => void
}

const Ctx = createContext<MyriadCtx | null>(null)

/** Rolling inspector log size. 50 is enough to see "a few minutes of show
 *  changes" without bloating renderer memory. */
const MAX_LOG = 50

/** Status poll cadence while the UI is open — cheap (a couple of IPC calls)
 *  and lets the inspector show live counters without a per-event refresh. */
const STATUS_POLL_MS = 2000

export function MyriadBridgeProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<MyriadStatus | null>(null)
  const [events, setEvents] = useState<MyriadLogEntry[]>([])
  const [lastRaw, setLastRaw] = useState<string | null>(null)
  // Track mount across the async initial fetch so we don't set state after
  // the provider unmounts (e.g. during HMR).
  const mountedRef = useRef(true)

  const refresh = useCallback(async () => {
    if (!studio?.myriadStatus) return
    try {
      const s = await studio.myriadStatus()
      if (mountedRef.current) setStatus(s)
    } catch (e) {
      // IPC failures shouldn't crash the UI — leave the last-known status in
      // place and try again next poll.
      console.warn('[myriad] status fetch failed:', e)
    }
  }, [])

  // Initial fetch + subscribe to the two main→renderer broadcast channels.
  useEffect(() => {
    mountedRef.current = true
    void refresh()
    if (!studio?.onMyriadEvent || !studio?.onMyriadRaw) return () => { mountedRef.current = false }

    const offEvent = studio.onMyriadEvent((e: MyriadEvent) => {
      // Stamp on arrival in the renderer (NOT the main-process timestamp) so
      // the inspector shows a coherent timeline even if main's clock skews.
      const entry: MyriadLogEntry = { event: e, receivedAt: Date.now() }
      setEvents(prev => {
        const next = [entry, ...prev]
        if (next.length > MAX_LOG) next.length = MAX_LOG
        return next
      })
    })
    const offRaw = studio.onMyriadRaw((s: string) => {
      setLastRaw(s)
    })
    return () => {
      mountedRef.current = false
      try { offEvent?.() } catch { /* ignore */ }
      try { offRaw?.() } catch { /* ignore */ }
    }
  }, [refresh])

  // Light status polling for the inspector counters. Not strictly needed for
  // correctness (every setter calls refresh()) but it lets the parse-error /
  // messages-received counters tick up live while the UI is open.
  useEffect(() => {
    const id = window.setInterval(() => { void refresh() }, STATUS_POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  // ── Setters ────────────────────────────────────────────────────────────────
  // Each one writes to main + immediately re-fetches status so the UI doesn't
  // flicker stale values for a tick.
  const setEnabled = useCallback(async (on: boolean) => {
    if (!studio?.myriadSetEnabled) return
    try { await studio.myriadSetEnabled(on) } catch (e) { console.warn('[myriad] setEnabled failed:', e) }
    await refresh()
  }, [refresh])

  const setPort = useCallback(async (p: number) => {
    if (!studio?.myriadSetPort) return
    try { await studio.myriadSetPort(p) } catch (e) { console.warn('[myriad] setPort failed:', e) }
    await refresh()
  }, [refresh])

  const setHost = useCallback(async (h: string) => {
    if (!studio?.myriadSetHost) return
    try { await studio.myriadSetHost(h) } catch (e) { console.warn('[myriad] setHost failed:', e) }
    await refresh()
  }, [refresh])

  const clearLog = useCallback(() => {
    setEvents([])
    setLastRaw(null)
  }, [])

  return (
    <Ctx.Provider value={{ status, events, lastRaw, setEnabled, setPort, setHost, refresh, clearLog }}>
      {children}
    </Ctx.Provider>
  )
}

export function useMyriadBridge(): MyriadCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useMyriadBridge must be used inside MyriadBridgeProvider')
  return ctx
}
