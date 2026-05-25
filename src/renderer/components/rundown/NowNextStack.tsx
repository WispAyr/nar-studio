/**
 * Now/Next stack — Myriad's signature playout-deck visualisation.
 *
 * A vertical sandwich: the current row (big, full bleed, type-tinted) on
 * top, the next two queued rows beneath at half-height. Each row gets the
 * familiar left-edge colour block + monospace duration; the current row
 * adds a giant time-remaining countdown with a thin progress bar.
 *
 * Designed to live as a slim panel in the main workspace — drop it
 * anywhere the operator's eye should land for "what's on, what's next"
 * without having to open the Run tab. Works fine if there's no current
 * row (just shows the next-2 queue) or no rundown at all (renders nothing).
 */
import { useEffect, useState } from 'react'
import { useRundown, type RundownRow, type RundownRowType } from '../../rundown/RundownProvider'
import { MYRIAD_COLORS, MYRIAD_LABELS, rundownTypeToMyriad } from '../common/itemTypeColors'

function fmtTime(sec: number): string {
  const sign = sec < 0 ? '-' : ''
  const s = Math.abs(Math.floor(sec))
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${sign}${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`
}

function styleFor(type: RundownRowType): { hex: string; label: string } {
  const m = rundownTypeToMyriad(type)
  const overrides: Partial<Record<RundownRowType, string>> = {
    intro: 'INTRO', outro: 'OUTRO', talk: 'TALK', 'ad-break': 'AD-BREAK',
  }
  return { hex: MYRIAD_COLORS[m].hex, label: overrides[type] ?? MYRIAD_LABELS[m] }
}

interface BigRowProps {
  row: RundownRow
  elapsedSec: number
  remainingSec: number
}

/** The "now" panel — biggest visual element, time-rich, type-tinted. */
function BigRow({ row, elapsedSec, remainingSec }: BigRowProps) {
  const s = styleFor(row.type)
  // Progress 0..1. Avoid division by zero on a 0-second row.
  const progress = row.durationSec > 0
    ? Math.min(1, Math.max(0, elapsedSec / row.durationSec))
    : 0
  const isWarning = remainingSec >= 0 && remainingSec < 15
  return (
    <div className="relative flex items-stretch bg-surface-900 rounded overflow-hidden">
      {/* Type stripe — wider than the rundown's so this row dominates the eye. */}
      <div className="w-2 self-stretch shrink-0" style={{ background: s.hex }} />
      <div className="flex flex-col gap-1 flex-1 min-w-0 px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-white"
            style={{ background: s.hex }}
          >
            {s.label}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-nar-red font-bold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-nar-red animate-pulse" />
            ON DECK
          </span>
        </div>
        <div className="flex items-end justify-between gap-2 min-w-0">
          <span className="text-base font-bold text-white truncate flex-1">
            {row.title || <em className="text-slate-600">(untitled)</em>}
          </span>
          <span className={`tabular-nums font-mono font-bold ${isWarning ? 'text-nar-red' : 'text-nar-amber'} text-xl leading-none`}>
            {fmtTime(remainingSec)}
          </span>
        </div>
        {/* Progress bar — thin, full width, recoloured red in the final
            15 seconds to warn the operator to advance. */}
        <div className="h-1 bg-surface-800 rounded-full overflow-hidden mt-1">
          <div
            className={`h-full rounded-full transition-[width] duration-700 ${isWarning ? 'bg-nar-red' : 'bg-nar-amber'}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
    </div>
  )
}

/** Smaller queued-row view. Two of these stack under the BigRow. */
function SmallRow({ row, position }: { row: RundownRow; position: number }) {
  const s = styleFor(row.type)
  return (
    <div className="relative flex items-center bg-surface-900/60 rounded overflow-hidden">
      <div className="w-1.5 self-stretch shrink-0" style={{ background: s.hex }} />
      <div className="flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5">
        <span className="text-[9px] font-mono text-slate-600 w-4 shrink-0 tabular-nums">
          {position.toString().padStart(2, '0')}
        </span>
        <span
          className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
          style={{ background: `${s.hex}33`, color: s.hex }}
        >
          {s.label}
        </span>
        <span className="text-xs text-slate-300 truncate flex-1">
          {row.title || <em className="text-slate-600">(untitled)</em>}
        </span>
        <span className="text-[10px] tabular-nums font-mono text-slate-500 shrink-0">
          {fmtTime(row.durationSec)}
        </span>
      </div>
    </div>
  )
}

interface Props {
  /** Optional className on the outer container so this can be sized by callers. */
  className?: string
  /** Header label — defaults to "Now / Next". Set null to hide the header. */
  header?: string | null
}

export function NowNextStack({ className = '', header = 'Now / Next' }: Props) {
  const r = useRundown()
  // Force a re-render at 1Hz so the countdown ticks even when rundown state
  // is otherwise idle. Cheap — single state bump.
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  if (r.rows.length === 0) return null

  const cur = r.currentRowIndex != null ? r.rows[r.currentRowIndex] : null
  const queue: RundownRow[] = []
  const startIdx = (r.currentRowIndex ?? -1) + 1
  for (let i = startIdx; i < r.rows.length && queue.length < 2; i++) {
    queue.push(r.rows[i])
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {header && (
        <div className="flex items-center justify-between px-1">
          <span className="text-[9px] text-slate-600 uppercase tracking-wider font-bold">{header}</span>
          {cur && r.currentRowIndex != null && (
            <span className="text-[9px] text-slate-600 font-mono">
              Row {(r.currentRowIndex + 1).toString().padStart(2, '0')} / {r.rows.length.toString().padStart(2, '0')}
            </span>
          )}
        </div>
      )}
      {cur ? (
        <BigRow row={cur} elapsedSec={r.elapsedSec} remainingSec={r.remainingSec} />
      ) : (
        <div className="bg-surface-900/40 border border-dashed border-surface-800 rounded px-3 py-3 text-xs text-slate-500 text-center">
          Rundown stopped — press Start in the Run tab to begin
        </div>
      )}
      {queue.length > 0 && (
        <div className="flex flex-col gap-1">
          {queue.map((row, i) => (
            <SmallRow key={row.id} row={row} position={startIdx + i + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
