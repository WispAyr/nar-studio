/**
 * Shows + GlobalStream provider.
 *
 * Owns the array of NarShow definitions, the currentShowId, and the
 * GlobalStreamConfig. Wraps a hook for `applyShow(showId)` that pushes a
 * show's production defaults into the viz / engine / CG providers — viz
 * mode, palette, layout, presenter, on-by-default title templates, sponsor.
 *
 * The provider deliberately keeps the data + the actions co-located so the
 * Myriad bridge has a single seam to bind to in the future:
 *
 *     myriadBridge.on('show-start', e => shows.applyShowByName(e.name))
 *     myriadBridge.on('advert-start', e => shows.fireBumperByName(e.name))
 */

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from 'react'
import {
  type GlobalStreamConfig, DEFAULT_GLOBAL_STREAM,
  type NarShow, type NarSponsor,
} from './types'
import { useViz } from '../viz/VizProvider'
import { useEngine } from '../engine/EngineProvider'
import { useCG, TITLE_TEMPLATES } from '../cg/CGProvider'
import { useSchedule } from '../hooks/useSchedule'

const LS_SHOWS = 'nar-shows'
const LS_CURRENT_SHOW = 'nar-current-show'
const LS_GLOBAL = 'nar-global-stream'
const LS_SPONSORS = 'nar-sponsors-library'

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return (parsed ?? fallback) as T
  } catch { return fallback }
}

function saveJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
}

function newId(prefix = 'show'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`
}

interface ShowsContextValue {
  // ── Shows ──
  shows: NarShow[]
  addShow: (show: Omit<NarShow, 'id'>) => string
  updateShow: (id: string, patch: Partial<NarShow>) => void
  removeShow: (id: string) => void

  // ── Current show selection ──
  /** Stable id of the active show; null = sustaining (no show). */
  currentShowId: string | null
  /** Resolved NarShow object, or null. */
  currentShow: NarShow | null
  /** Set the current show + apply its production defaults to the live system. */
  setCurrentShow: (id: string | null) => void
  /** Look up a show by name + set it as current. Useful for schedule auto-bind
   *  AND for the future Myriad bridge (`MM_TRIGGER` show-start by name). */
  applyShowByName: (name: string) => boolean

  // ── Global stream ──
  global: GlobalStreamConfig
  setGlobal: (patch: Partial<GlobalStreamConfig>) => void

  // ── Sponsors (station-wide library; shows reference by id) ──
  sponsors: NarSponsor[]
  addSponsor: (s: Omit<NarSponsor, 'id'>) => string
  updateSponsor: (id: string, patch: Partial<NarSponsor>) => void
  removeSponsor: (id: string) => void
  /** Pull sponsors for the current show (or all if no show / no sponsorIds set). */
  currentSponsors: () => NarSponsor[]
}

const Ctx = createContext<ShowsContextValue | null>(null)

export function ShowsProvider({ children }: { children: ReactNode }) {
  const viz = useViz()
  const engine = useEngine()
  const cg = useCG()
  const schedule = useSchedule()

  const [shows, setShows] = useState<NarShow[]>(() => loadJson<NarShow[]>(LS_SHOWS, []))
  const [currentShowId, setCurrentShowIdState] = useState<string | null>(
    () => loadJson<string | null>(LS_CURRENT_SHOW, null)
  )
  const [global, setGlobalState] = useState<GlobalStreamConfig>(
    () => ({ ...DEFAULT_GLOBAL_STREAM, ...loadJson<Partial<GlobalStreamConfig>>(LS_GLOBAL, {}) })
  )
  const [sponsors, setSponsors] = useState<NarSponsor[]>(() => loadJson<NarSponsor[]>(LS_SPONSORS, []))

  // Mirror to localStorage on every change. Cheap; total payload is small.
  useEffect(() => { saveJson(LS_SHOWS, shows) }, [shows])
  useEffect(() => { saveJson(LS_CURRENT_SHOW, currentShowId) }, [currentShowId])
  useEffect(() => { saveJson(LS_GLOBAL, global) }, [global])
  useEffect(() => { saveJson(LS_SPONSORS, sponsors) }, [sponsors])

  // ── Show CRUD ──────────────────────────────────────────────────────────────
  const addShow = useCallback((show: Omit<NarShow, 'id'>): string => {
    const id = newId('show')
    setShows(s => [...s, { ...show, id }])
    return id
  }, [])
  const updateShow = useCallback((id: string, patch: Partial<NarShow>) => {
    setShows(s => s.map(sh => sh.id === id ? { ...sh, ...patch } : sh))
  }, [])
  const removeShow = useCallback((id: string) => {
    setShows(s => s.filter(sh => sh.id !== id))
    setCurrentShowIdState(cur => cur === id ? null : cur)
  }, [])

  // ── Sponsor CRUD ───────────────────────────────────────────────────────────
  const addSponsor = useCallback((s: Omit<NarSponsor, 'id'>): string => {
    const id = newId('spo')
    setSponsors(prev => [...prev, { ...s, id }])
    return id
  }, [])
  const updateSponsor = useCallback((id: string, patch: Partial<NarSponsor>) => {
    setSponsors(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }, [])
  const removeSponsor = useCallback((id: string) => {
    setSponsors(prev => prev.filter(s => s.id !== id))
    // Cascade — drop references from any show that pointed at this sponsor.
    setShows(prev => prev.map(sh => sh.sponsorIds
      ? { ...sh, sponsorIds: sh.sponsorIds.filter(x => x !== id) }
      : sh))
  }, [])

  // ── Apply a show's production defaults to the live system ─────────────────
  // Co-located here so the side effects are visible at the data layer. The
  // operator's manual tweaks after applying are NOT clobbered by repeat-apply
  // until they pick another show — we only push on the show transition.
  const applyShowDefaults = useCallback((show: NarShow | null) => {
    if (!show) return
    if (typeof show.defaultVizMode === 'number') viz.setMode(show.defaultVizMode)
    if (typeof show.defaultVizPalette === 'number') viz.setPalette(show.defaultVizPalette)
    if (show.defaultLayout) engine.setLayout(show.defaultLayout)
    // The current presenter feeds the lower-third + the now-on-air card via
    // schedule.presenter — but operators may want a per-show override. For
    // now we just leave presenter to the schedule poller; future work can
    // expose a `setPresenterOverride` on EngineProvider.
    // Toggle on the templates the show defines as defaults (only if not already on).
    if (show.defaultTitleTemplates) {
      const meta = TITLE_TEMPLATES
      for (const tpl of show.defaultTitleTemplates) {
        const onAir = cg.layers.some(l => l.kind === 'title' && l.template === tpl)
        if (!onAir && meta.find(m => m.template === tpl)) cg.toggleTitle(tpl)
      }
    }
    // Sponsor — if the show has a single sponsor, write it into the CG state.
    const firstSponsorId = show.sponsorIds?.[0]
    if (firstSponsorId) {
      const sp = sponsors.find(s => s.id === firstSponsorId)
      if (sp) cg.setSponsor(sp.name, sp.tagline)
    }
  }, [viz, engine, cg, sponsors])

  // ── Current-show transition driver ─────────────────────────────────────────
  // Apply on every change of currentShowId so the runtime picks up new
  // configuration without the operator having to click "Apply".
  //
  // CRUCIAL: skip the very first invocation. On boot we restore currentShowId
  // from localStorage but we must NOT auto-apply its defaults — the operator
  // may have walked away with a custom viz / layout setup and re-applying
  // would silently clobber it. Only USER-INITIATED show changes (via
  // setCurrentShow, applyShowByName) or schedule auto-binds should push
  // defaults to the live system.
  const lastAppliedRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (lastAppliedRef.current === undefined) {
      // First run after mount — just record the current value, don't apply.
      lastAppliedRef.current = currentShowId
      return
    }
    if (lastAppliedRef.current === currentShowId) return
    lastAppliedRef.current = currentShowId
    const show = shows.find(s => s.id === currentShowId) ?? null
    applyShowDefaults(show)
  }, [currentShowId, shows, applyShowDefaults])

  const setCurrentShow = useCallback((id: string | null) => {
    setCurrentShowIdState(id)
  }, [])

  const applyShowByName = useCallback((name: string): boolean => {
    const norm = name.trim().toLowerCase()
    if (!norm) return false
    const match = shows.find(s => s.name.trim().toLowerCase() === norm)
    if (match) { setCurrentShowIdState(match.id); return true }
    return false
  }, [shows])

  // ── Schedule auto-bind ─────────────────────────────────────────────────────
  // Whenever the siphon schedule says a new show is current, look for a
  // matching NarShow by name and switch to it. The operator can still
  // manually override afterward.
  //
  // Same boot-time guard as the apply effect: on first mount we observe the
  // schedule's current value but do NOT auto-bind to it, otherwise every
  // app launch would silently swap shows + clobber the operator's last
  // manual state. Only genuine schedule TRANSITIONS auto-bind.
  const lastScheduleNameRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const name = schedule.current?.name ?? null
    if (lastScheduleNameRef.current === undefined) {
      lastScheduleNameRef.current = name
      return
    }
    if (name === lastScheduleNameRef.current) return
    lastScheduleNameRef.current = name
    if (name) applyShowByName(name)
  }, [schedule.current, applyShowByName])

  // ── Global stream config ───────────────────────────────────────────────────
  const setGlobal = useCallback((patch: Partial<GlobalStreamConfig>) => {
    setGlobalState(g => ({ ...g, ...patch }))
  }, [])

  // Top-of-hour ident — when enabled, fire the configured card at xx:00.
  // Independent of the per-show ScheduledFires system because it should
  // survive show changes (it's station-wide).
  useEffect(() => {
    if (!global.topOfHourIdentEnabled) return
    let lastHour = new Date().getHours()
    const tick = () => {
      const now = new Date()
      // Fire on the transition into a new hour at minute 0.
      if (now.getMinutes() === 0 && now.getHours() !== lastHour) {
        lastHour = now.getHours()
        const tpl = global.topOfHourTemplate
        const onAir = cg.layers.some(l => l.kind === 'title' && l.template === tpl)
        if (!onAir) {
          cg.toggleTitle(tpl)
          if (global.topOfHourHoldSeconds > 0) {
            window.setTimeout(() => {
              const stillOn = cg.layers.some(l => l.kind === 'title' && l.template === tpl)
              if (stillOn) cg.toggleTitle(tpl)
            }, global.topOfHourHoldSeconds * 1000)
          }
        }
      }
    }
    const id = window.setInterval(tick, 5000)
    return () => window.clearInterval(id)
  }, [global.topOfHourIdentEnabled, global.topOfHourTemplate, global.topOfHourHoldSeconds, cg])

  // ── Sustaining viz when no show is current ─────────────────────────────────
  // Fires the sustaining viz mode only on a genuine show→null TRANSITION.
  // Same boot-time guard: on initial mount we just observe whether a show is
  // current, we never auto-push the sustaining viz mode at startup. The
  // operator's last-used viz mode persists across launches via VizProvider.
  const lastShowSeenRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (lastShowSeenRef.current === undefined) {
      lastShowSeenRef.current = currentShowId
      return
    }
    const prev = lastShowSeenRef.current
    lastShowSeenRef.current = currentShowId
    // Only when we transition FROM a show TO no-show.
    if (prev !== null && currentShowId === null) {
      viz.setMode(global.sustainingVizMode)
    }
  }, [currentShowId, global.sustainingVizMode, viz])

  const currentSponsors = useCallback((): NarSponsor[] => {
    const show = shows.find(s => s.id === currentShowId)
    if (!show?.sponsorIds || show.sponsorIds.length === 0) return sponsors
    return sponsors.filter(s => show.sponsorIds!.includes(s.id))
  }, [shows, sponsors, currentShowId])

  const currentShow = shows.find(s => s.id === currentShowId) ?? null

  return (
    <Ctx.Provider value={{
      shows, addShow, updateShow, removeShow,
      currentShowId, currentShow, setCurrentShow, applyShowByName,
      global, setGlobal,
      sponsors, addSponsor, updateSponsor, removeSponsor, currentSponsors,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useShows(): ShowsContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useShows must be used inside ShowsProvider')
  return ctx
}
