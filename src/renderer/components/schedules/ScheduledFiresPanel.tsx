import { useMemo, useState } from 'react'
import { TITLE_TEMPLATES } from '../../cg/CGProvider'
import {
  HOUR_MASK_ALL,
  useScheduledFires,
  type ScheduledFire,
} from '../../schedules/ScheduledFiresProvider'
import type { TitleTemplate } from '../../cg/types'

const TAKEOVER_TEMPLATES = TITLE_TEMPLATES.filter(t => t.group === 'takeover')

/** Pretty "xx:15" — always two-digit, with the leading xx since it repeats per hour. */
function fmtMinute(m: number): string {
  return `xx:${m.toString().padStart(2, '0')}`
}

/** Compress a 24-bit hour mask into a human readout. */
function fmtHourMask(mask: number): string {
  if ((mask & HOUR_MASK_ALL) === HOUR_MASK_ALL) return 'every hour'
  const hours: number[] = []
  for (let h = 0; h < 24; h++) if (mask & (1 << h)) hours.push(h)
  if (hours.length === 0) return 'no hours (disabled)'
  if (hours.length === 24) return 'every hour'
  // Group consecutive runs: 6,7,8,9,10 -> "6-10"
  const runs: string[] = []
  let start = hours[0]
  let prev = hours[0]
  for (let i = 1; i < hours.length; i++) {
    const h = hours[i]
    if (h === prev + 1) {
      prev = h
    } else {
      runs.push(start === prev ? `${start}` : `${start}-${prev}`)
      start = h
      prev = h
    }
  }
  runs.push(start === prev ? `${start}` : `${start}-${prev}`)
  return `hours ${runs.join(',')}`
}

function fmtHold(seconds: number): string {
  if (seconds <= 0) return 'hold ∞'
  if (seconds < 60) return `hold ${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s === 0 ? `hold ${m}m` : `hold ${m}m${s}s`
}

function templateLabel(t: TitleTemplate): string {
  return TITLE_TEMPLATES.find(x => x.template === t)?.label ?? t
}

interface NewRuleFormProps {
  onCancel: () => void
  onSave: (rule: Omit<ScheduledFire, 'id'>) => void
}

function NewRuleForm({ onCancel, onSave }: NewRuleFormProps) {
  // Sensible defaults — sponsor card, xx:15, every hour, 30s hold.
  const defaultTemplate = TAKEOVER_TEMPLATES[0]?.template ?? 'sponsor'
  const [label, setLabel] = useState('New scheduled fire')
  const [minuteOfHour, setMinuteOfHour] = useState(15)
  const [hourMask, setHourMask] = useState(HOUR_MASK_ALL)
  const [template, setTemplate] = useState<TitleTemplate>(defaultTemplate)
  const [holdSeconds, setHoldSeconds] = useState(30)

  const toggleHour = (h: number) => {
    setHourMask(prev => prev ^ (1 << h))
  }

  return (
    <div className="flex flex-col gap-2 bg-surface-800 border border-surface-700 rounded p-2">
      <div className="flex items-center gap-2">
        <label className="text-[10px] text-slate-500 uppercase tracking-wider w-16">Label</label>
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          className="flex-1 bg-surface-900 border border-surface-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-nar-blue/60"
        />
      </div>

      <div className="flex items-center gap-2">
        <label className="text-[10px] text-slate-500 uppercase tracking-wider w-16">Minute</label>
        <input
          type="range" min={0} max={59} value={minuteOfHour}
          onChange={e => setMinuteOfHour(Number(e.target.value))}
          className="flex-1 accent-nar-amber"
        />
        <span className="text-xs font-mono text-nar-amber w-12 text-right">{fmtMinute(minuteOfHour)}</span>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Hours</span>
          <div className="flex gap-1">
            <button
              onClick={() => setHourMask(HOUR_MASK_ALL)}
              className="text-[10px] text-slate-500 hover:text-slate-300"
            >
              all
            </button>
            <button
              onClick={() => setHourMask(0)}
              className="text-[10px] text-slate-500 hover:text-slate-300"
            >
              none
            </button>
          </div>
        </div>
        <div className="grid grid-cols-12 gap-0.5">
          {Array.from({ length: 24 }, (_, h) => {
            const on = (hourMask & (1 << h)) !== 0
            return (
              <button
                key={h}
                onClick={() => toggleHour(h)}
                className={`text-[10px] py-0.5 rounded font-mono transition-colors ${
                  on
                    ? 'bg-nar-amber text-surface-950'
                    : 'bg-surface-900 text-slate-600 hover:text-slate-300'
                }`}
              >
                {h.toString().padStart(2, '0')}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-[10px] text-slate-500 uppercase tracking-wider w-16">Card</label>
        <select
          value={template}
          onChange={e => setTemplate(e.target.value as TitleTemplate)}
          className="flex-1 bg-surface-900 border border-surface-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-nar-blue/60"
        >
          {TAKEOVER_TEMPLATES.map(t => (
            <option key={t.template} value={t.template}>{t.label}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-[10px] text-slate-500 uppercase tracking-wider w-16">Hold</label>
        <input
          type="number"
          min={0}
          step={5}
          value={holdSeconds}
          onChange={e => setHoldSeconds(Math.max(0, Number(e.target.value) || 0))}
          className="w-20 bg-surface-900 border border-surface-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-nar-blue/60"
        />
        <span className="text-[10px] text-slate-500">seconds · 0 = leave on</span>
      </div>

      <div className="flex justify-end gap-1 mt-1">
        <button
          onClick={onCancel}
          className="text-xs px-2 py-1 rounded text-slate-400 hover:text-white hover:bg-surface-700"
        >
          Cancel
        </button>
        <button
          onClick={() => onSave({
            label: label.trim() || 'Untitled rule',
            enabled: true,
            minuteOfHour,
            hourMask,
            template,
            holdSeconds,
          })}
          className="text-xs px-2 py-1 rounded bg-nar-amber text-surface-950 font-bold hover:brightness-110"
        >
          Save rule
        </button>
      </div>
    </div>
  )
}

interface RuleRowProps {
  rule: ScheduledFire
  onToggleEnable: () => void
  onFireNow: () => void
  onRemove: () => void
  onRename: (label: string) => void
}

function RuleRow({ rule, onToggleEnable, onFireNow, onRemove, onRename }: RuleRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(rule.label)

  const scheduleReadout = useMemo(() => `${fmtMinute(rule.minuteOfHour)} ${fmtHourMask(rule.hourMask)}`, [rule.minuteOfHour, rule.hourMask])

  const commit = () => {
    const next = draft.trim()
    setEditing(false)
    if (next && next !== rule.label) onRename(next)
    else setDraft(rule.label)
  }

  return (
    <div className="flex items-center gap-1.5 bg-surface-800 rounded px-2 py-1.5 text-xs">
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${rule.enabled ? 'bg-nar-green shadow-[0_0_6px_rgba(34,197,94,0.6)]' : 'bg-slate-600'}`}
        title={rule.enabled ? 'Armed' : 'Disabled'}
      />
      <div className="flex flex-col min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') commit()
              else if (e.key === 'Escape') { setDraft(rule.label); setEditing(false) }
            }}
            className="bg-surface-900 border border-surface-700 rounded px-1 py-0.5 text-xs text-slate-200 outline-none focus:border-nar-blue/60"
          />
        ) : (
          <button
            onClick={() => { setDraft(rule.label); setEditing(true) }}
            className="text-left text-slate-200 hover:text-white truncate"
            title="Click to rename"
          >
            {rule.label}
          </button>
        )}
        <span className="text-[10px] text-slate-500 truncate">
          <span className="text-nar-amber/80 font-mono">{scheduleReadout}</span>
          <span className="text-slate-600"> · </span>
          <span>{templateLabel(rule.template)}</span>
          <span className="text-slate-600"> · </span>
          <span>{fmtHold(rule.holdSeconds)}</span>
        </span>
      </div>
      <button
        onClick={onToggleEnable}
        title={rule.enabled ? 'Disarm' : 'Arm'}
        className={`shrink-0 text-xs px-1.5 py-0.5 rounded font-bold transition-colors ${
          rule.enabled
            ? 'bg-nar-amber/20 text-nar-amber hover:bg-nar-amber/30'
            : 'bg-surface-700 text-slate-500 hover:text-slate-300'
        }`}
      >
        ✓
      </button>
      <button
        onClick={onFireNow}
        title="Fire now"
        className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-surface-700 text-slate-300 hover:bg-nar-blue hover:text-white transition-colors"
      >
        ▶
      </button>
      <button
        onClick={onRemove}
        title="Delete rule"
        className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-surface-700 text-slate-500 hover:bg-nar-red hover:text-white transition-colors"
      >
        ×
      </button>
    </div>
  )
}

export function ScheduledFiresPanel() {
  const { rules, addRule, updateRule, removeRule, setEnabled, fireNow } = useScheduledFires()
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex flex-col gap-2 bg-surface-900 border border-surface-700 rounded p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500 uppercase tracking-wider">Scheduled Auto-Fires</span>
        <span className="text-[10px] text-slate-600">
          {rules.filter(r => r.enabled).length}/{rules.length} armed
        </span>
      </div>

      {rules.length === 0 && !adding && (
        <div className="text-[11px] text-slate-600 italic py-2 text-center">
          No rules yet. Add one to fire a brand card on the clock.
        </div>
      )}

      {rules.length > 0 && (
        <div className="flex flex-col gap-1">
          {rules.map(rule => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onToggleEnable={() => setEnabled(rule.id, !rule.enabled)}
              onFireNow={() => fireNow(rule.id)}
              onRemove={() => removeRule(rule.id)}
              onRename={label => updateRule(rule.id, { label })}
            />
          ))}
        </div>
      )}

      {adding ? (
        <NewRuleForm
          onCancel={() => setAdding(false)}
          onSave={rule => {
            addRule(rule)
            setAdding(false)
          }}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-xs px-2 py-1.5 rounded bg-surface-800 border border-dashed border-surface-700 text-slate-400 hover:text-white hover:border-nar-amber/60 hover:bg-surface-800/80 transition-colors"
        >
          + New rule
        </button>
      )}
    </div>
  )
}
