import { useEffect, useMemo, useRef, useState } from 'react'
import { useSchedule } from '../../hooks/useSchedule'
import { useViz } from '../../viz/VizProvider'
import { NAR_LOGO_DATA_URI } from '../../cg/narLogo'
import { HourClock, type HourClockEvent } from '../common/HourClock'
import { MYRIAD_COLORS, type MyriadItemType } from '../common/itemTypeColors'
import { useScheduledFires } from '../../schedules/ScheduledFiresProvider'
import { useShows } from '../../shows/ShowsProvider'
import type { TitleTemplate } from '../../cg/types'

function PaceIndicator() {
  const { levelsRef, audioActive } = useViz()
  const audioActiveRef = useRef(audioActive)
  audioActiveRef.current = audioActive
  const [pace, setPace] = useState({ bpm: 0, locked: false, beat: 0 })

  useEffect(() => {
    const id = window.setInterval(() => {
      const lv = levelsRef.current
      const bpm = Math.round(lv.bpm)
      const locked = lv.bpmConfident && audioActiveRef.current
      setPace(prev =>
        prev.bpm === bpm && prev.locked === locked && Math.abs(prev.beat - lv.beat) < 0.05
          ? prev
          : { bpm, locked, beat: lv.beat })
    }, 150)
    return () => window.clearInterval(id)
  }, [levelsRef])

  return (
    <div
      className="flex items-center gap-1.5 shrink-0"
      title={pace.locked ? 'Pace locked — tempo-driven triggers active' : 'Listening for a stable tempo…'}
    >
      <div
        className="w-1.5 h-1.5 rounded-full"
        style={{
          background: pace.locked ? '#f7931e' : '#2e2e3a',
          opacity: pace.locked ? 0.45 + 0.55 * pace.beat : 1,
        }}
      />
      <span className={`text-xs tabular-nums font-bold ${pace.locked ? 'text-nar-amber' : 'text-slate-600'}`}>
        {pace.locked && pace.bpm > 50 ? pace.bpm : '—'}
      </span>
      <span className="text-[10px] text-slate-500 tracking-wider">BPM</span>
    </div>
  )
}

/** Chunkier monospace wall clock — the operator's primary time anchor. */
function WallClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const hh = time.getHours().toString().padStart(2, '0')
  const mm = time.getMinutes().toString().padStart(2, '0')
  const ss = time.getSeconds().toString().padStart(2, '0')
  return (
    <div className="flex items-baseline gap-1 px-2 h-7 rounded bg-surface-950/60 border border-surface-700 tabular-nums leading-none">
      <span className="text-base font-bold text-white">{hh}</span>
      <span className="text-base font-bold text-slate-600">:</span>
      <span className="text-base font-bold text-white">{mm}</span>
      <span className="text-xs font-bold text-nar-amber">:{ss}</span>
    </div>
  )
}

/**
 * Map a CG title template to a Myriad item-type colour so the HourClock
 * dot tint reflects what the scheduled rule will actually fire.
 */
function templateToMyriad(t: TitleTemplate): MyriadItemType {
  if (t === 'news-banner') return 'news'
  if (t === 'travel-banner') return 'travel'
  if (t === 'sponsor') return 'sponsor'
  if (t === 'be-right-back' || t === 'stand-by') return 'jingle'
  if (t === 'now-on-air' || t === 'coming-up') return 'show'
  if (t === 'music-sweeper') return 'sweeper'
  if (t === 'technical-difficulty') return 'other'
  return 'other'
}

/**
 * Canonical landmarks — shown when the operator has no active ScheduledFires.
 * Mirrors NAR's habit (news on the hour + half, travel quarter-past + to).
 */
const FALLBACK_LANDMARKS: HourClockEvent[] = [
  { minuteOfHour: 0,  color: MYRIAD_COLORS.news.hex,    label: ':00 News (suggested)' },
  { minuteOfHour: 15, color: MYRIAD_COLORS.travel.hex,  label: ':15 Travel (suggested)' },
  { minuteOfHour: 30, color: MYRIAD_COLORS.news.hex,    label: ':30 News (suggested)' },
  { minuteOfHour: 45, color: MYRIAD_COLORS.travel.hex,  label: ':45 Travel (suggested)' },
]

/**
 * Derive the HourClock dots from the operator's active ScheduledFires for
 * the current hour. Falls back to the canonical NAR landmarks if no rules
 * are enabled this hour — so the dial is never empty + always reads as a
 * NAR clock.
 */
function useHourEvents(): HourClockEvent[] {
  const { rules } = useScheduledFires()
  const { currentShow } = useShows()
  const [hour, setHour] = useState(() => new Date().getHours())
  useEffect(() => {
    // Poll hour at 30s — cheap, and we don't need sub-minute precision; the
    // dot set only changes at the hour boundary.
    const id = setInterval(() => setHour(new Date().getHours()), 30000)
    return () => clearInterval(id)
  }, [])

  const events = useMemo(() => {
    const out: HourClockEvent[] = []
    // ─ Layer 1: enabled scheduled-fires for the current hour. Always shown.
    const hourBit = 1 << hour
    for (const r of rules) {
      if (!r.enabled) continue
      if (!(r.hourMask & hourBit)) continue
      const m = templateToMyriad(r.template)
      out.push({
        minuteOfHour: r.minuteOfHour,
        color: MYRIAD_COLORS[m].hex,
        label: `:${r.minuteOfHour.toString().padStart(2, '0')} ${r.label}`,
      })
    }
    // ─ Layer 2: per-show landmarks for the current show. These reflect the
    // operator's own canonical hour shape and merge with the scheduled fires.
    const showLandmarks = currentShow?.hourLandmarks ?? []
    for (const l of showLandmarks) {
      out.push({
        minuteOfHour: l.minute,
        color: MYRIAD_COLORS[l.type].hex,
        label: `:${l.minute.toString().padStart(2, '0')} ${l.label}`,
      })
    }
    // Sort by minute so the dial paints the dots in the order an operator
    // would read them clockwise.
    out.sort((a, b) => a.minuteOfHour - b.minuteOfHour)
    // ─ Fallback: if no layer produced anything, paint the canonical landmarks
    // (news on the hour + half, travel quarter-past + to). The dial is never
    // empty so the operator's eye anchors on familiar positions even on a
    // bare configuration.
    return out.length > 0 ? out : FALLBACK_LANDMARKS
  }, [rules, hour, currentShow])
  return events
}

export function ScheduleBanner() {
  const { current, next, nextIn, progress, stale } = useSchedule()
  const hourEvents = useHourEvents()

  return (
    <div className="flex items-center gap-3 px-3 h-12 bg-surface-900 border-b border-surface-700 shrink-0">
      {/* Station ident */}
      <div className="flex items-center shrink-0 pr-2 border-r border-surface-800 h-9">
        <img src={NAR_LOGO_DATA_URI} alt="Now Ayrshire Radio" className="h-7 w-auto" />
      </div>

      {/* Hour clock — iconic Myriad dial; dots driven by enabled
          ScheduledFires for the current hour (falls back to NAR's
          canonical news / travel landmarks when no rules are active). */}
      <div className="flex items-center gap-2 shrink-0">
        <HourClock size={40} events={hourEvents} />
        <div className="flex flex-col leading-none">
          <span className="text-[9px] text-slate-600 uppercase tracking-wider">Hour</span>
          <span className="text-[10px] text-slate-400 font-bold tabular-nums">
            {new Date().getHours().toString().padStart(2, '0')}:--
          </span>
        </div>
      </div>

      <div className="h-9 w-px bg-surface-800 shrink-0" />

      {/* Current show */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {current?.thumbnail && (
          <img src={current.thumbnail} className="h-7 w-7 rounded object-cover shrink-0" alt="" />
        )}
        <div className="flex flex-col min-w-0">
          <span className="text-[9px] text-nar-red uppercase tracking-wider leading-none font-bold">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-nar-red animate-pulse mr-1.5 align-middle" />
            ON AIR
          </span>
          <span className="text-sm font-bold text-white truncate leading-tight mt-0.5">
            {current?.name ?? '—'}
          </span>
        </div>

        {/* Progress bar */}
        {current && (
          <div className="flex-1 max-w-48 h-1 bg-surface-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-nar-red rounded-full transition-all duration-1000"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* Next show */}
      {next && (
        <div className="flex flex-col items-end shrink-0 leading-none">
          <span className="text-[9px] text-slate-600 uppercase tracking-wider">Up Next</span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-300 font-medium truncate max-w-40">{next.name}</span>
            {nextIn && (
              <span className="text-[11px] text-nar-amber font-mono font-bold tabular-nums">
                {nextIn}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="h-9 w-px bg-surface-800 shrink-0" />

      {stale && (
        <span className="text-[10px] text-nar-amber shrink-0 font-bold uppercase tracking-wider">⚠ stale</span>
      )}

      <PaceIndicator />

      <WallClock />
    </div>
  )
}
