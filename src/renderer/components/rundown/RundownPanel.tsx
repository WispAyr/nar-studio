import { useEffect, useMemo, useRef, useState } from 'react'
import { useRundown, type RundownAction, type RundownRow, type RundownRowType } from '../../rundown/RundownProvider'
import { TITLE_TEMPLATES } from '../../cg/CGProvider'
import type { TitleTemplate } from '../../cg/types'
import { VIZ_MODES } from '../../viz/VizProvider'
import { useCartwall } from '../../cartwall/CartWallProvider'
import { MYRIAD_COLORS, MYRIAD_LABELS, rundownTypeToMyriad } from '../common/itemTypeColors'

/**
 * Show rundown panel.
 *
 * Header row, transport strip, scrolling row list, an add-row form, and a
 * compact action chip language so the operator can read what each row is
 * going to fire at a glance.
 */

/**
 * Per-row visual identity — derived from the shared Myriad palette so the
 * rundown reads the same way an operator scans a Myriad log. We keep
 * `label` as the row-type override (some types like INTRO want a clearer
 * label than the Myriad fallback) and pull bg/text classes from the
 * central map.
 */
const TYPE_BADGE: Record<RundownRowType, { label: string; hex: string; bgFaded: string; textOnFaded: string }> = (() => {
  const o = {} as Record<RundownRowType, { label: string; hex: string; bgFaded: string; textOnFaded: string }>
  const overrides: Partial<Record<RundownRowType, string>> = {
    intro: 'INTRO', outro: 'OUTRO', talk: 'TALK', 'ad-break': 'AD-BREAK',
  }
  ;(['intro', 'music', 'talk', 'news', 'interview', 'ad-break', 'sponsor', 'outro', 'other'] as RundownRowType[]).forEach(t => {
    const m = rundownTypeToMyriad(t)
    o[t] = {
      label: overrides[t] ?? MYRIAD_LABELS[m],
      hex: MYRIAD_COLORS[m].hex,
      bgFaded: MYRIAD_COLORS[m].bgFaded,
      textOnFaded: MYRIAD_COLORS[m].textOnFaded,
    }
  })
  return o
})()

const ROW_TYPES: RundownRowType[] = [
  'intro', 'music', 'talk', 'news', 'interview', 'ad-break', 'sponsor', 'outro', 'other',
]

function fmtTime(totalSec: number): string {
  const sign = totalSec < 0 ? '-' : ''
  const s = Math.abs(Math.floor(totalSec))
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${sign}${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`
}

function parseTime(input: string): number {
  // Accepts "90", "1:30", "01:30". Anything else falls back to 0.
  const trimmed = input.trim()
  if (!trimmed) return 0
  if (/^\d+$/.test(trimmed)) return Math.max(0, parseInt(trimmed, 10))
  const m = trimmed.match(/^(\d+):(\d{1,2})$/)
  if (!m) return 0
  const mm = parseInt(m[1], 10)
  const ss = parseInt(m[2], 10)
  if (!Number.isFinite(mm) || !Number.isFinite(ss)) return 0
  return mm * 60 + Math.min(59, Math.max(0, ss))
}

function describeAction(action: RundownAction, cartLabels: string[]): { icon: string; text: string } {
  switch (action.kind) {
    case 'cg-card': {
      const label = TITLE_TEMPLATES.find(t => t.template === action.template)?.label ?? action.template
      const hold = action.holdSeconds ? ` · ${action.holdSeconds}s` : ''
      return { icon: '🎬', text: `${label}${hold}` }
    }
    case 'viz-mode': {
      const label = VIZ_MODES.find(m => m.id === action.id)?.label ?? `mode ${action.id}`
      return { icon: '🎵', text: `viz · ${label}` }
    }
    case 'cartwall-fire': {
      const label = cartLabels[action.slotIndex] ?? `Cart ${action.slotIndex + 1}`
      return { icon: '🔊', text: `cart · ${label}` }
    }
    case 'clear-takeovers':
      return { icon: '⏹', text: 'clear takeovers' }
  }
}

export function RundownPanel() {
  const rundown = useRundown()
  const cartwall = useCartwall()
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  const cartLabels = useMemo(() => cartwall.slots.map(s => s.label), [cartwall.slots])

  const remaining = rundown.remainingSec
  const isUrgent = rundown.currentRowIndex != null && remaining < 15 && remaining > -9999

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-900">
      {/* Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700 shrink-0">
        <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Rundown</span>
        <button
          onClick={() => { setShowAdd(s => !s); setEditing(null) }}
          className="text-xs px-2 py-1 rounded bg-surface-800 hover:bg-surface-700 text-slate-300 hover:text-white border border-surface-700"
          title="Add a new row to the rundown"
        >
          + Add row
        </button>
      </div>

      {/* Transport strip ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-surface-700 shrink-0 bg-surface-900">
        {rundown.currentRowIndex == null ? (
          <button
            onClick={rundown.start}
            disabled={rundown.rows.length === 0}
            className="text-xs px-2.5 py-1 rounded bg-nar-green/80 hover:bg-nar-green text-white font-semibold disabled:bg-surface-800 disabled:text-slate-600 disabled:cursor-not-allowed"
            title="Start the rundown from row 1"
          >
            ▶ Start
          </button>
        ) : (
          <button
            onClick={rundown.stop}
            className="text-xs px-2.5 py-1 rounded bg-nar-red hover:bg-nar-red/90 text-white font-semibold"
            title="Stop the rundown and drop every takeover card"
          >
            ■ Stop
          </button>
        )}
        <button
          onClick={() => {
            if (rundown.currentRowIndex != null && rundown.currentRowIndex > 0) {
              rundown.jumpTo(rundown.currentRowIndex - 1)
            }
          }}
          disabled={rundown.currentRowIndex == null || rundown.currentRowIndex <= 0}
          className="text-xs px-2 py-1 rounded bg-surface-800 hover:bg-surface-700 text-slate-300 disabled:text-slate-600 disabled:cursor-not-allowed border border-surface-700"
          title="Previous row"
        >
          ◄ Prev
        </button>
        <button
          onClick={rundown.advance}
          disabled={rundown.rows.length === 0
            || (rundown.currentRowIndex != null && rundown.currentRowIndex >= rundown.rows.length - 1)}
          className="text-xs px-2 py-1 rounded bg-surface-800 hover:bg-surface-700 text-slate-300 disabled:text-slate-600 disabled:cursor-not-allowed border border-surface-700"
          title="Advance to the next row and fire its actions"
        >
          Next ►
        </button>
        <label
          className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500 cursor-pointer select-none"
          title="When on, the rundown auto-advances when a row's clock hits zero"
        >
          <input
            type="checkbox"
            checked={rundown.autoAdvance}
            onChange={e => rundown.setAutoAdvance(e.target.checked)}
            className="accent-nar-blue"
          />
          AUTO
        </label>
        <div className="flex-1" />
        <div
          className={`font-mono text-lg leading-none px-2 py-1 rounded tabular-nums ${
            rundown.currentRowIndex == null
              ? 'text-slate-700'
              : isUrgent
                ? 'text-nar-amber bg-nar-amber/10 animate-pulse'
                : 'text-slate-200'
          }`}
          title="Remaining time on the current row"
        >
          {rundown.currentRowIndex == null ? '--:--' : fmtTime(remaining)}
        </div>
      </div>

      {/* Add-row form ───────────────────────────────────────────────────── */}
      {showAdd && (
        <RowForm
          onCancel={() => setShowAdd(false)}
          onSave={row => { rundown.addRow(row); setShowAdd(false) }}
          cartLabels={cartLabels}
        />
      )}

      {/* Row list ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {rundown.rows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-slate-600 italic px-6 text-center">
            No rundown yet — add your first row to begin
          </div>
        ) : (
          <ul className="flex flex-col">
            {rundown.rows.map((row, idx) => {
              const isCurrent = rundown.currentRowIndex === idx
              const isDone = rundown.currentRowIndex != null && idx < rundown.currentRowIndex
              const isEditing = editing === row.id
              return (
                <li key={row.id} className="border-b border-surface-800">
                  <Row
                    row={row}
                    index={idx}
                    isCurrent={isCurrent}
                    isDone={isDone}
                    isFirst={idx === 0}
                    isLast={idx === rundown.rows.length - 1}
                    cartLabels={cartLabels}
                    onClick={() => rundown.jumpTo(idx)}
                    onEdit={() => { setEditing(row.id); setShowAdd(false) }}
                    onRemove={() => rundown.removeRow(row.id)}
                    onMoveUp={() => rundown.moveRow(row.id, -1)}
                    onMoveDown={() => rundown.moveRow(row.id, 1)}
                    onFireActions={() => rundown.runActions(row.actions)}
                  />
                  {isEditing && (
                    <RowForm
                      initial={row}
                      onCancel={() => setEditing(null)}
                      onSave={patch => {
                        rundown.updateRow(row.id, patch)
                        setEditing(null)
                      }}
                      cartLabels={cartLabels}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── Row ─────────────────────────────────────────────────────────────────────

interface RowProps {
  row: RundownRow
  index: number
  isCurrent: boolean
  isDone: boolean
  isFirst: boolean
  isLast: boolean
  cartLabels: string[]
  onClick: () => void
  onEdit: () => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onFireActions: () => void
}

function Row(props: RowProps) {
  const { row, index, isCurrent, isDone, isFirst, isLast, cartLabels } = props
  const badge = TYPE_BADGE[row.type]

  return (
    <div
      onClick={props.onClick}
      onDoubleClick={props.onEdit}
      className={`group relative flex items-stretch cursor-pointer transition-colors ${
        isCurrent
          ? 'bg-surface-800/80'
          : isDone
            ? 'bg-surface-900 hover:bg-surface-800 opacity-50'
            : 'bg-surface-900 hover:bg-surface-800'
      }`}
      title={row.notes || row.title}
    >
      {/* Myriad-style solid colour block on the left edge — paints the type
          in a way the operator's eye reads in one glance, no need to parse
          the badge text. Wider stripe when the row is current. */}
      <div
        className="shrink-0 self-stretch transition-all"
        style={{ width: isCurrent ? 8 : 5, background: badge.hex, opacity: isDone ? 0.4 : 1 }}
      />

      <div className="flex items-stretch gap-2 px-2 py-2 flex-1 min-w-0">
        <div className={`text-[10px] font-mono w-5 shrink-0 self-start mt-0.5 tabular-nums ${
          isCurrent ? 'text-white font-bold' : 'text-slate-600'
        }`}>
          {(index + 1).toString().padStart(2, '0')}
        </div>

      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded ${badge.bgFaded} ${badge.textOnFaded} shrink-0`}>
            {badge.label}
          </span>
          <span className="text-xs text-slate-200 truncate flex-1">{row.title || <em className="text-slate-600">(untitled)</em>}</span>
          <span className="text-[11px] font-mono text-slate-400 tabular-nums shrink-0 font-bold">{fmtTime(row.durationSec)}</span>
        </div>
        {row.actions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {row.actions.map((a, i) => {
              const desc = describeAction(a, cartLabels)
              return (
                <span
                  key={i}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-surface-800 border border-surface-700 text-slate-400 truncate max-w-[140px]"
                  title={`${desc.icon} ${desc.text}`}
                >
                  <span className="mr-1">{desc.icon}</span>{desc.text}
                </span>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col items-end gap-1 shrink-0 self-start">
        <span className={`text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${
          isCurrent
            ? 'bg-nar-red text-white animate-pulse'
            : isDone
              ? 'bg-slate-700 text-slate-400'
              : 'bg-transparent text-slate-600'
        }`}>
          {isCurrent ? 'current' : isDone ? 'done' : 'pending'}
        </span>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
          {row.actions.length > 0 && (
            <button
              onClick={e => { e.stopPropagation(); props.onFireActions() }}
              title="Fire this row's actions now (without jumping to it)"
              className="text-[10px] text-slate-500 hover:text-nar-amber px-1"
            >
              ▸
            </button>
          )}
          <button
            onClick={e => { e.stopPropagation(); props.onMoveUp() }}
            disabled={isFirst}
            title="Move up"
            className="text-[10px] text-slate-500 hover:text-white disabled:text-slate-800 disabled:cursor-not-allowed px-1"
          >
            ↑
          </button>
          <button
            onClick={e => { e.stopPropagation(); props.onMoveDown() }}
            disabled={isLast}
            title="Move down"
            className="text-[10px] text-slate-500 hover:text-white disabled:text-slate-800 disabled:cursor-not-allowed px-1"
          >
            ↓
          </button>
          <button
            onClick={e => { e.stopPropagation(); props.onEdit() }}
            title="Edit"
            className="text-[10px] text-slate-500 hover:text-white px-1"
          >
            ⋮
          </button>
          <button
            onClick={e => { e.stopPropagation(); props.onRemove() }}
            title="Remove"
            className="text-[10px] text-slate-500 hover:text-nar-red px-1"
          >
            ✕
          </button>
        </div>
      </div>
      </div>{/* close the .flex.items-stretch wrapper that holds order + content + status */}
    </div>
  )
}

// ── Row form (add + edit share the same shape) ──────────────────────────────

interface RowFormProps {
  initial?: RundownRow
  onCancel: () => void
  onSave: (row: Omit<RundownRow, 'id'>) => void
  cartLabels: string[]
}

function RowForm({ initial, onCancel, onSave, cartLabels }: RowFormProps) {
  const [type, setType] = useState<RundownRowType>(initial?.type ?? 'music')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [durationStr, setDurationStr] = useState(
    initial ? fmtTime(initial.durationSec) : '03:00',
  )
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [actions, setActions] = useState<RundownAction[]>(initial?.actions ?? [])

  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => { titleRef.current?.focus() }, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({
      type,
      title: title.trim(),
      durationSec: parseTime(durationStr),
      notes: notes.trim() ? notes.trim() : undefined,
      actions,
    })
  }

  const addAction = (a: RundownAction) => setActions(prev => [...prev, a])
  const removeAction = (idx: number) => setActions(prev => prev.filter((_, i) => i !== idx))

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 p-3 bg-surface-800 border-l-2 border-nar-blue/60 border-b border-surface-700"
    >
      <div className="flex items-center gap-2">
        <select
          value={type}
          onChange={e => setType(e.target.value as RundownRowType)}
          className="bg-surface-900 border border-surface-700 rounded text-xs text-slate-200 outline-none px-2 py-1"
        >
          {ROW_TYPES.map(t => (
            <option key={t} value={t}>{TYPE_BADGE[t].label}</option>
          ))}
        </select>
        <input
          ref={titleRef}
          type="text"
          placeholder="Row title (e.g. Top of the hour news)"
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="flex-1 bg-surface-900 border border-surface-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-nar-blue/60"
        />
        <input
          type="text"
          placeholder="mm:ss"
          value={durationStr}
          onChange={e => setDurationStr(e.target.value)}
          className="w-16 bg-surface-900 border border-surface-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-nar-blue/60 font-mono tabular-nums"
          title="Duration — mm:ss or raw seconds"
        />
      </div>

      <textarea
        placeholder="Producer notes (optional)"
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={2}
        className="bg-surface-900 border border-surface-700 rounded px-2 py-1 text-xs text-slate-300 outline-none focus:border-nar-blue/60 resize-none"
      />

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Actions · fired when row goes live</span>
        </div>
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {actions.map((a, i) => {
              const desc = describeAction(a, cartLabels)
              return (
                <span key={i} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-surface-900 border border-surface-700 text-slate-300">
                  <span>{desc.icon}</span>{desc.text}
                  <button
                    type="button"
                    onClick={() => removeAction(i)}
                    className="text-slate-500 hover:text-nar-red"
                    title="Remove action"
                  >
                    ✕
                  </button>
                </span>
              )
            })}
          </div>
        )}
        <ActionPicker onAdd={addAction} cartLabels={cartLabels} />
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-2 py-1 rounded bg-surface-900 hover:bg-surface-700 text-slate-400 border border-surface-700"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="text-xs px-3 py-1 rounded bg-nar-blue hover:bg-nar-blue/90 text-white font-semibold"
        >
          {initial ? 'Save' : 'Add row'}
        </button>
      </div>
    </form>
  )
}

// ── Action picker ──────────────────────────────────────────────────────────

interface ActionPickerProps {
  onAdd: (a: RundownAction) => void
  cartLabels: string[]
}

function ActionPicker({ onAdd, cartLabels }: ActionPickerProps) {
  const [kind, setKind] = useState<RundownAction['kind']>('cg-card')
  const [template, setTemplate] = useState<TitleTemplate>(TITLE_TEMPLATES[0].template)
  const [holdSeconds, setHoldSeconds] = useState<string>('')
  const [vizId, setVizId] = useState<number>(VIZ_MODES[0].id)
  const [slotIndex, setSlotIndex] = useState<number>(0)

  const submit = () => {
    switch (kind) {
      case 'cg-card': {
        const hold = holdSeconds.trim() ? Math.max(0, parseInt(holdSeconds, 10)) : undefined
        onAdd(Number.isFinite(hold as number) && (hold as number) > 0
          ? { kind: 'cg-card', template, holdSeconds: hold }
          : { kind: 'cg-card', template })
        break
      }
      case 'viz-mode':
        onAdd({ kind: 'viz-mode', id: vizId })
        break
      case 'cartwall-fire':
        onAdd({ kind: 'cartwall-fire', slotIndex })
        break
      case 'clear-takeovers':
        onAdd({ kind: 'clear-takeovers' })
        break
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1 p-1.5 rounded bg-surface-900 border border-dashed border-surface-700">
      <select
        value={kind}
        onChange={e => setKind(e.target.value as RundownAction['kind'])}
        className="bg-surface-800 border border-surface-700 rounded text-[10px] text-slate-300 outline-none px-1.5 py-0.5"
      >
        <option value="cg-card">CG Card</option>
        <option value="viz-mode">Viz Mode</option>
        <option value="cartwall-fire">Cart Fire</option>
        <option value="clear-takeovers">Clear Takeovers</option>
      </select>
      {kind === 'cg-card' && (
        <>
          <select
            value={template}
            onChange={e => setTemplate(e.target.value as TitleTemplate)}
            className="bg-surface-800 border border-surface-700 rounded text-[10px] text-slate-300 outline-none px-1.5 py-0.5"
          >
            {TITLE_TEMPLATES.map(t => (
              <option key={t.template} value={t.template}>
                {t.group === 'takeover' ? '★ ' : ''}{t.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            inputMode="numeric"
            placeholder="hold s"
            value={holdSeconds}
            onChange={e => setHoldSeconds(e.target.value.replace(/[^0-9]/g, ''))}
            title="Optional — auto-drop the card after N seconds"
            className="w-14 bg-surface-800 border border-surface-700 rounded text-[10px] text-slate-300 outline-none px-1.5 py-0.5"
          />
        </>
      )}
      {kind === 'viz-mode' && (
        <select
          value={vizId}
          onChange={e => setVizId(Number(e.target.value))}
          className="bg-surface-800 border border-surface-700 rounded text-[10px] text-slate-300 outline-none px-1.5 py-0.5"
        >
          {VIZ_MODES.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      )}
      {kind === 'cartwall-fire' && (
        <select
          value={slotIndex}
          onChange={e => setSlotIndex(Number(e.target.value))}
          className="bg-surface-800 border border-surface-700 rounded text-[10px] text-slate-300 outline-none px-1.5 py-0.5"
        >
          {cartLabels.map((label, i) => (
            <option key={i} value={i}>{i + 1}. {label}</option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={submit}
        className="text-[10px] px-2 py-0.5 rounded bg-nar-blue/80 hover:bg-nar-blue text-white"
      >
        + add
      </button>
    </div>
  )
}
