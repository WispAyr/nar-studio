import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useCG } from '../cg/CGProvider'
import type { TitleTemplate } from '../cg/types'

/** localStorage key — bumped only if the rule shape ever changes incompatibly. */
const STORAGE_KEY = 'nar-scheduled-fires'

/** Every-hour bitmask convenience — all 24 hour-of-day bits set. */
export const HOUR_MASK_ALL = 0xFFFFFF

/**
 * A single scheduled rule. The clock fires the rule's CG card when the
 * wall-clock hits `minuteOfHour` AND `hourMask` has the current hour bit set
 * (e.g. bit 6 = 06:00 hour). After `holdSeconds` the rule auto-drops the card,
 * but only if it's still on — so the operator can dismiss it early without
 * the hold timer re-toggling it back on.
 */
export interface ScheduledFire {
  id: string
  label: string
  enabled: boolean
  /** 0-59 — minute of the hour the fire is scheduled for. */
  minuteOfHour: number
  /** Bitmask of hours-of-day (0-23). 0xFFFFFF = every hour. */
  hourMask: number
  template: TitleTemplate
  /** Auto-drop after this many seconds. 0 = leave on, operator drops manually. */
  holdSeconds: number
}

export interface ScheduledFiresContextValue {
  rules: ScheduledFire[]
  addRule: (rule: Omit<ScheduledFire, 'id'>) => string
  updateRule: (id: string, patch: Partial<Omit<ScheduledFire, 'id'>>) => void
  removeRule: (id: string) => void
  setEnabled: (id: string, on: boolean) => void
  /** Manual one-shot — respects holdSeconds so it behaves like an auto-fire. */
  fireNow: (id: string) => void
}

const Ctx = createContext<ScheduledFiresContextValue | null>(null)

function loadRules(): ScheduledFire[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Defensive validation — anything malformed is dropped silently so a
    // broken rule never wedges the whole scheduler.
    return parsed.filter((r: any): r is ScheduledFire =>
      r &&
      typeof r.id === 'string' &&
      typeof r.label === 'string' &&
      typeof r.enabled === 'boolean' &&
      typeof r.minuteOfHour === 'number' && r.minuteOfHour >= 0 && r.minuteOfHour < 60 &&
      typeof r.hourMask === 'number' &&
      typeof r.template === 'string' &&
      typeof r.holdSeconds === 'number' && r.holdSeconds >= 0,
    )
  } catch {
    return []
  }
}

function saveRules(rules: ScheduledFire[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules))
  } catch {
    /* localStorage full or unavailable — silent, rules just won't persist. */
  }
}

let ruleSeq = 0
function newId(): string {
  ruleSeq += 1
  // Combine seq + time + random — collision-safe across reloads.
  return `sf-${Date.now().toString(36)}-${ruleSeq}-${Math.random().toString(36).slice(2, 6)}`
}

export function ScheduledFiresProvider({ children }: { children: ReactNode }) {
  const cg = useCG()
  const [rules, setRules] = useState<ScheduledFire[]>(() => loadRules())

  // Persist on every change.
  useEffect(() => { saveRules(rules) }, [rules])

  // Latest values that the 1s tick needs to see without re-binding the interval.
  const rulesRef = useRef<ScheduledFire[]>(rules)
  rulesRef.current = rules
  const cgRef = useRef(cg)
  cgRef.current = cg

  /**
   * Per-rule "last minute we fired this in" map. Prevents a single 1s tick
   * from re-firing the same rule multiple times within the same wall-clock
   * minute. Key: rule id. Value: epoch-minute (Math.floor(Date.now() / 60000)).
   */
  const lastFiredMinute = useRef<Map<string, number>>(new Map())

  /** Pending auto-drop timers, keyed by rule id, so we can cancel/replace. */
  const dropTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  /**
   * Fire a single rule: toggle the card on now, and schedule an auto-drop
   * after holdSeconds (if > 0). The drop double-checks the layer is still
   * present before re-toggling, so an operator-dismissed card isn't yanked
   * back on by the timer.
   */
  const doFire = useCallback((rule: ScheduledFire) => {
    const { toggleTitle } = cgRef.current
    const alreadyOn = cgRef.current.layers.some(l => l.template === rule.template)
    // If somehow already on (operator already fired it manually), don't toggle
    // it OFF — just let the existing card live and let the hold timer drop it.
    if (!alreadyOn) {
      toggleTitle(rule.template)
    }

    // Cancel any existing pending drop for this rule (rare — rule re-fired
    // while previous hold still running, e.g. fireNow during a hold).
    const prev = dropTimers.current.get(rule.id)
    if (prev) {
      clearTimeout(prev)
      dropTimers.current.delete(rule.id)
    }

    if (rule.holdSeconds > 0) {
      const t = setTimeout(() => {
        dropTimers.current.delete(rule.id)
        // Only drop if the card is still on — operator might have already
        // dismissed it, in which case toggling now would turn it back ON.
        const stillOn = cgRef.current.layers.some(l => l.template === rule.template)
        if (stillOn) {
          cgRef.current.toggleTitle(rule.template)
        }
      }, rule.holdSeconds * 1000)
      dropTimers.current.set(rule.id, t)
    }
  }, [])

  // The clock — checked every second. Cheap (a handful of rules, integer
  // compares only) so 1 Hz is fine.
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const minute = now.getMinutes()
      const hour = now.getHours()
      const epochMinute = Math.floor(now.getTime() / 60000)
      for (const rule of rulesRef.current) {
        if (!rule.enabled) continue
        if (rule.minuteOfHour !== minute) continue
        if ((rule.hourMask & (1 << hour)) === 0) continue
        const last = lastFiredMinute.current.get(rule.id)
        if (last === epochMinute) continue
        lastFiredMinute.current.set(rule.id, epochMinute)
        doFire(rule)
      }
    }
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [doFire])

  // Tidy up any pending drop timers on unmount (e.g. hot-reload, app close).
  useEffect(() => {
    const timers = dropTimers.current
    return () => {
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
    }
  }, [])

  const addRule = useCallback((rule: Omit<ScheduledFire, 'id'>) => {
    const id = newId()
    setRules(prev => [...prev, { ...rule, id }])
    return id
  }, [])

  const updateRule = useCallback((id: string, patch: Partial<Omit<ScheduledFire, 'id'>>) => {
    setRules(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }, [])

  const removeRule = useCallback((id: string) => {
    // Also cancel any pending drop so removing a rule mid-hold doesn't leave
    // a ghost timer flipping the card.
    const t = dropTimers.current.get(id)
    if (t) {
      clearTimeout(t)
      dropTimers.current.delete(id)
    }
    lastFiredMinute.current.delete(id)
    setRules(prev => prev.filter(r => r.id !== id))
  }, [])

  const setEnabled = useCallback((id: string, on: boolean) => {
    setRules(prev => prev.map(r => (r.id === id ? { ...r, enabled: on } : r)))
  }, [])

  const fireNow = useCallback((id: string) => {
    const rule = rulesRef.current.find(r => r.id === id)
    if (!rule) return
    // Mark as fired this minute so the regular tick doesn't double-fire it.
    lastFiredMinute.current.set(rule.id, Math.floor(Date.now() / 60000))
    doFire(rule)
  }, [doFire])

  const value = useMemo<ScheduledFiresContextValue>(() => ({
    rules, addRule, updateRule, removeRule, setEnabled, fireNow,
  }), [rules, addRule, updateRule, removeRule, setEnabled, fireNow])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useScheduledFires(): ScheduledFiresContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useScheduledFires must be used within ScheduledFiresProvider')
  return ctx
}
