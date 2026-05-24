import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import { useCG, TITLE_TEMPLATES } from '../cg/CGProvider'
import type { TitleTemplate } from '../cg/types'
import { useViz } from '../viz/VizProvider'
import { useCartwall } from '../cartwall/CartWallProvider'

/**
 * Show rundown — the operator's run-of-show.
 *
 * A rundown is the ordered list of segments the operator is going to drive
 * through tonight. Each row carries an expected duration plus an optional
 * bundle of actions that fire the moment the row goes live: pop a CG card,
 * switch the visualizer, hit a sting on the cart wall, drop every active
 * takeover. The operator advances manually, or the timer auto-advances when
 * the row's clock hits zero.
 *
 * Persistence is to localStorage under `nar-rundown`. Only the rows are
 * persisted — the current row index, start time and auto-advance flag are
 * runtime-only so a reload always lands cleanly in "stopped".
 */

const LS_KEY = 'nar-rundown'

export type RundownRowType =
  | 'intro' | 'music' | 'talk' | 'news' | 'interview'
  | 'ad-break' | 'sponsor' | 'outro' | 'other'

export type RundownAction =
  | { kind: 'cg-card'; template: TitleTemplate; holdSeconds?: number }
  | { kind: 'viz-mode'; id: number }
  | { kind: 'cartwall-fire'; slotIndex: number }
  | { kind: 'clear-takeovers' }

export interface RundownRow {
  id: string
  type: RundownRowType
  title: string
  durationSec: number
  notes?: string
  actions: RundownAction[]
}

interface RundownCtxValue {
  rows: RundownRow[]
  currentRowIndex: number | null
  currentStartedAt: number | null
  autoAdvance: boolean
  elapsedSec: number
  remainingSec: number
  addRow: (row: Omit<RundownRow, 'id'>) => string
  updateRow: (id: string, patch: Partial<RundownRow>) => void
  removeRow: (id: string) => void
  moveRow: (id: string, direction: -1 | 1) => void
  start: () => void
  advance: () => void
  jumpTo: (index: number) => void
  stop: () => void
  setAutoAdvance: (on: boolean) => void
  runActions: (actions: RundownAction[]) => void
}

const Ctx = createContext<RundownCtxValue | null>(null)

let rowSeq = 0
function newId(): string {
  rowSeq += 1
  return `rd-${Date.now().toString(36)}-${rowSeq.toString(36)}`
}

function loadRows(): RundownRow[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const validTypes: RundownRowType[] = [
      'intro', 'music', 'talk', 'news', 'interview',
      'ad-break', 'sponsor', 'outro', 'other',
    ]
    const out: RundownRow[] = []
    for (const r of parsed) {
      if (!r || typeof r !== 'object') continue
      const id = typeof r.id === 'string' && r.id ? r.id : newId()
      const type = validTypes.includes(r.type) ? r.type : 'other'
      const title = typeof r.title === 'string' ? r.title : ''
      const durationSec = Number.isFinite(r.durationSec) && r.durationSec >= 0
        ? Math.round(r.durationSec)
        : 60
      const notes = typeof r.notes === 'string' ? r.notes : undefined
      const actions = Array.isArray(r.actions)
        ? r.actions.filter((a: any) => a && typeof a.kind === 'string') as RundownAction[]
        : []
      out.push({ id, type, title, durationSec, notes, actions })
    }
    return out
  } catch {
    return []
  }
}

function saveRows(rows: RundownRow[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(rows)) } catch { /* ignore */ }
}

/** Set of takeover templates — used by the `clear-takeovers` action. */
const TAKEOVER_TEMPLATES: ReadonlySet<TitleTemplate> = new Set(
  TITLE_TEMPLATES.filter(t => t.group === 'takeover').map(t => t.template),
)

export function RundownProvider({ children }: { children: ReactNode }) {
  const cg = useCG()
  const viz = useViz()
  const cartwall = useCartwall()

  const [rows, setRows] = useState<RundownRow[]>(loadRows)
  const [currentRowIndex, setCurrentRowIndex] = useState<number | null>(null)
  const [currentStartedAt, setCurrentStartedAt] = useState<number | null>(null)
  const [autoAdvance, setAutoAdvanceState] = useState(false)
  // `nowMs` ticks once a second so elapsed/remaining recompute and any
  // <RundownPanel/> subscriber re-renders without each consumer wiring its
  // own timer.
  const [nowMs, setNowMs] = useState<number>(() => Date.now())

  useEffect(() => { saveRows(rows) }, [rows])

  // Stable refs for the action runner — `runActions` is exposed on the
  // context, and we want it to capture the latest provider deps without
  // re-creating it (which would cascade into re-renders for every consumer).
  const cgRef = useRef(cg); cgRef.current = cg
  const vizRef = useRef(viz); vizRef.current = viz
  const cartwallRef = useRef(cartwall); cartwallRef.current = cartwall

  const clearTakeovers = useCallback(() => {
    const layers = cgRef.current.layers
    for (const layer of layers) {
      if (layer.kind !== 'title' || !layer.template) continue
      if (!TAKEOVER_TEMPLATES.has(layer.template)) continue
      // toggleTitle on an active template drops it. Skip layers already
      // mid-exit so we don't try to remove a half-gone card.
      if (layer.removingAt != null) continue
      cgRef.current.toggleTitle(layer.template)
    }
  }, [])

  const runActions = useCallback((actions: RundownAction[]) => {
    for (const action of actions) {
      switch (action.kind) {
        case 'cg-card': {
          // toggleTitle is idempotent: if the template is already on air, it
          // would drop it — which is the wrong behaviour when a rundown row
          // says "fire the card". Only fire when not currently visible.
          const already = cgRef.current.layers.some(
            l => l.kind === 'title' && l.template === action.template && l.removingAt == null,
          )
          if (!already) cgRef.current.toggleTitle(action.template)
          if (action.holdSeconds && action.holdSeconds > 0) {
            const template = action.template
            window.setTimeout(() => {
              const layer = cgRef.current.layers.find(
                l => l.kind === 'title' && l.template === template && l.removingAt == null,
              )
              if (layer) cgRef.current.toggleTitle(template)
            }, action.holdSeconds * 1000)
          }
          break
        }
        case 'viz-mode': {
          vizRef.current.setMode(action.id)
          break
        }
        case 'cartwall-fire': {
          const slots = cartwallRef.current.slots
          const slot = slots[action.slotIndex]
          if (slot) cartwallRef.current.fire(slot.id)
          break
        }
        case 'clear-takeovers': {
          clearTakeovers()
          break
        }
      }
    }
  }, [clearTakeovers])

  // Row mutation API ────────────────────────────────────────────────────────

  const addRow = useCallback((row: Omit<RundownRow, 'id'>): string => {
    const id = newId()
    setRows(prev => [...prev, { ...row, id, actions: row.actions ?? [] }])
    return id
  }, [])

  const updateRow = useCallback((id: string, patch: Partial<RundownRow>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch, id: r.id } : r))
  }, [])

  // currentRowIndex is an index into the rows array — removing a row above
  // the current one would shift the live row, so we adjust it here rather
  // than orphan the runtime state.
  const removeRow = useCallback((id: string) => {
    setRows(prev => {
      const idx = prev.findIndex(r => r.id === id)
      if (idx < 0) return prev
      const next = prev.slice(0, idx).concat(prev.slice(idx + 1))
      setCurrentRowIndex(curr => {
        if (curr == null) return curr
        if (idx === curr) {
          // Live row removed — stop. The actions already fired; the operator
          // can manually advance from a clean state.
          setCurrentStartedAt(null)
          return null
        }
        if (idx < curr) return curr - 1
        return curr
      })
      return next
    })
  }, [])

  const moveRow = useCallback((id: string, direction: -1 | 1) => {
    setRows(prev => {
      const idx = prev.findIndex(r => r.id === id)
      if (idx < 0) return prev
      const target = idx + direction
      if (target < 0 || target >= prev.length) return prev
      const next = prev.slice()
      const [moved] = next.splice(idx, 1)
      next.splice(target, 0, moved)
      setCurrentRowIndex(curr => {
        if (curr == null) return curr
        if (curr === idx) return target
        if (direction === 1 && curr === idx + 1) return idx
        if (direction === -1 && curr === idx - 1) return idx
        return curr
      })
      return next
    })
  }, [])

  // Transport ───────────────────────────────────────────────────────────────

  const rowsRef = useRef(rows); rowsRef.current = rows

  const goToIndex = useCallback((index: number) => {
    const list = rowsRef.current
    if (index < 0 || index >= list.length) {
      setCurrentRowIndex(null)
      setCurrentStartedAt(null)
      return
    }
    setCurrentRowIndex(index)
    setCurrentStartedAt(Date.now())
    setNowMs(Date.now())
    runActions(list[index].actions)
  }, [runActions])

  const start = useCallback(() => {
    if (rowsRef.current.length === 0) return
    goToIndex(0)
  }, [goToIndex])

  const advance = useCallback(() => {
    setCurrentRowIndex(curr => {
      const list = rowsRef.current
      const nextIdx = curr == null ? 0 : curr + 1
      if (nextIdx >= list.length) {
        setCurrentStartedAt(null)
        return null
      }
      setCurrentStartedAt(Date.now())
      setNowMs(Date.now())
      runActions(list[nextIdx].actions)
      return nextIdx
    })
  }, [runActions])

  const jumpTo = useCallback((index: number) => {
    goToIndex(index)
  }, [goToIndex])

  const stop = useCallback(() => {
    setCurrentRowIndex(null)
    setCurrentStartedAt(null)
    clearTakeovers()
  }, [clearTakeovers])

  const setAutoAdvance = useCallback((on: boolean) => {
    setAutoAdvanceState(on)
  }, [])

  // 1 Hz clock — drives elapsed/remaining + auto-advance check.
  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  // Auto-advance — separate effect so the clock keeps running even when
  // auto-advance is off (the operator still sees elapsed/remaining).
  useEffect(() => {
    if (!autoAdvance) return
    if (currentRowIndex == null || currentStartedAt == null) return
    const row = rows[currentRowIndex]
    if (!row) return
    const elapsed = (nowMs - currentStartedAt) / 1000
    if (elapsed >= row.durationSec) {
      advance()
    }
  }, [autoAdvance, currentRowIndex, currentStartedAt, nowMs, rows, advance])

  const elapsedSec = currentStartedAt == null
    ? 0
    : Math.max(0, Math.floor((nowMs - currentStartedAt) / 1000))
  const remainingSec = currentRowIndex != null && rows[currentRowIndex]
    ? rows[currentRowIndex].durationSec - elapsedSec
    : 0

  const value = useMemo<RundownCtxValue>(() => ({
    rows,
    currentRowIndex,
    currentStartedAt,
    autoAdvance,
    elapsedSec,
    remainingSec,
    addRow,
    updateRow,
    removeRow,
    moveRow,
    start,
    advance,
    jumpTo,
    stop,
    setAutoAdvance,
    runActions,
  }), [
    rows, currentRowIndex, currentStartedAt, autoAdvance, elapsedSec, remainingSec,
    addRow, updateRow, removeRow, moveRow,
    start, advance, jumpTo, stop, setAutoAdvance, runActions,
  ])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRundown(): RundownCtxValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useRundown must be used inside RundownProvider')
  return ctx
}
