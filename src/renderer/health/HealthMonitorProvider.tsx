/**
 * Renderer-side mirror of the main-process HealthMonitor. Pulls the current
 * active alert list at mount and subscribes to live `health:alert` events.
 *
 * The wire protocol uses the same `id` to either raise or resolve an alert:
 * a follow-up `info` event with the word "resolved" in the message removes
 * the matching entry. New alerts with an existing `id` replace it (so an
 * alert that escalates from warning to critical updates in place).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

const studio = (window as any).studio

export type HealthLevel = 'info' | 'warning' | 'critical'

export interface HealthAlert {
  id: string
  level: HealthLevel
  message: string
  source: string
  timestamp: number
}

interface HealthCtx {
  alerts: HealthAlert[]
  dismiss: (id: string) => void
  critical: boolean
  warning: boolean
}

const Ctx = createContext<HealthCtx | null>(null)

/** Merge an incoming alert into the existing list using id-based dedupe. */
function reduceAlert(prev: HealthAlert[], next: HealthAlert): HealthAlert[] {
  const isResolution = next.level === 'info' && /resolved/i.test(next.message)
  if (isResolution) {
    // Resolution: drop any existing alert with the same id, swallow the info event.
    return prev.filter(a => a.id !== next.id)
  }
  const idx = prev.findIndex(a => a.id === next.id)
  if (idx === -1) return [...prev, next]
  // Replace in place — keeps list order stable across level escalations.
  const copy = prev.slice()
  copy[idx] = next
  return copy
}

export function HealthMonitorProvider({ children }: { children: ReactNode }) {
  const [alerts, setAlerts] = useState<HealthAlert[]>([])

  // Pull whatever alerts are already raised in main — covers the case where
  // the renderer is opened after main has been running (or hot-reloaded).
  useEffect(() => {
    let cancelled = false
    studio?.healthActive?.()
      .then((list: HealthAlert[]) => {
        if (!cancelled && Array.isArray(list)) setAlerts(list)
      })
      .catch(() => { /* main isn't ready yet — events will catch us up */ })
    return () => { cancelled = true }
  }, [])

  // Subscribe to live events. The preload returns an unsubscribe fn.
  useEffect(() => {
    const off = studio?.onHealthAlert?.((a: HealthAlert) => {
      setAlerts(prev => reduceAlert(prev, a))
    })
    return () => { if (typeof off === 'function') off() }
  }, [])

  const dismiss = useCallback((id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id))
    studio?.healthDismiss?.(id).catch(() => { /* ignore */ })
  }, [])

  const value = useMemo<HealthCtx>(() => {
    const critical = alerts.some(a => a.level === 'critical')
    const warning = !critical && alerts.some(a => a.level === 'warning')
    return { alerts, dismiss, critical, warning }
  }, [alerts, dismiss])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useHealth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useHealth must be used inside HealthMonitorProvider')
  return ctx
}
