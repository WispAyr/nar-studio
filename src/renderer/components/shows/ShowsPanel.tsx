import { useState } from 'react'
import { useShows } from '../../shows/ShowsProvider'
import { VIZ_MODES, VIZ_PALETTES } from '../../viz/VizProvider'
import { TITLE_TEMPLATES } from '../../cg/CGProvider'
import { useMyriadBridge } from '../../myriad/MyriadBridgeProvider'
import { useMyriadBinderEnabled } from '../../myriad/MyriadActionBinder'
import { MYRIAD_COLORS, MYRIAD_LABELS, type MyriadItemType } from '../common/itemTypeColors'
import { HourClock } from '../common/HourClock'
import type { NarShow, HourLandmark } from '../../shows/types'
import type { LayoutType } from '../../engine/types'

/**
 * Per-show production configuration management.
 *
 * Shows are the operator's named recipes — "Drive Time", "Weekend Breakfast",
 * "Late-Night Mellow". Each one bundles viz mode, layout, presenter info,
 * sponsor list, and rundown. When a show becomes current its defaults are
 * applied to the live system; the operator can still tweak afterward.
 *
 * Sustaining / off-show behaviour lives in the GlobalStreamConfig section
 * at the bottom of this panel.
 */
export function ShowsPanel() {
  const s = useShows()
  const [editingId, setEditingId] = useState<string | null>(null)
  const editingShow = editingId ? s.shows.find(x => x.id === editingId) ?? null : null

  return (
    <div className="flex flex-col gap-2 p-2 h-full overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-600 uppercase tracking-wider">Shows</span>
        <button
          onClick={() => {
            const id = s.addShow({
              name: 'New Show',
              presenter: '',
              defaultVizMode: 34,
              defaultLayout: 'solo' as LayoutType,
            })
            setEditingId(id)
          }}
          className="text-[10px] py-1 px-2 rounded bg-nar-blue text-white font-bold uppercase tracking-wider hover:bg-blue-500"
        >
          + New Show
        </button>
      </div>

      {/* Current show indicator */}
      <CurrentShowChip />

      {/* Show list */}
      {s.shows.length === 0 ? (
        <div className="text-[11px] text-slate-600 text-center py-6 px-2">
          No shows yet. Build your first show recipe — viz mode, layout, presenter, sponsor — and recall it with one click whenever it's on air.
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {s.shows.map(show => {
            const isCurrent = s.currentShowId === show.id
            return (
              <div
                key={show.id}
                className={`rounded border transition-colors ${
                  isCurrent
                    ? 'bg-surface-800 border-nar-red'
                    : 'bg-surface-900 border-surface-800 hover:border-surface-700'
                }`}
              >
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <button
                    onClick={() => s.setCurrentShow(isCurrent ? null : show.id)}
                    title={isCurrent ? 'Drop current show' : 'Make this show current — applies its defaults to the live system'}
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isCurrent ? 'bg-nar-red animate-pulse' : 'bg-surface-700 hover:bg-slate-500'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-slate-200 truncate">{show.name}</div>
                    <div className="text-[10px] text-slate-600 truncate">
                      {show.presenter || '—'} · {show.startTime || 'unscheduled'}
                    </div>
                  </div>
                  <button
                    onClick={() => setEditingId(show.id)}
                    title="Edit show"
                    className="text-[11px] text-slate-500 hover:text-slate-300 px-1"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Delete show "${show.name}"?`)) s.removeShow(show.id)
                    }}
                    title="Delete show"
                    className="text-[11px] text-slate-500 hover:text-nar-red px-1"
                  >
                    ×
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Sponsor library */}
      <SponsorLibrary />

      {/* Global stream config — sustaining + ident */}
      <GlobalStreamSection />

      {/* Myriad MM_TRIGGER UDP bridge — see docs/myriad-integration.md */}
      <MyriadBridgeSection />

      {/* Edit modal */}
      {editingShow && (
        <ShowEditor show={editingShow} onClose={() => setEditingId(null)} />
      )}
    </div>
  )
}

/** Live readout of the active show, with a "drop" button to clear. */
function CurrentShowChip() {
  const s = useShows()
  if (!s.currentShow) {
    return (
      <div className="rounded bg-surface-900 border border-surface-800 px-2 py-1.5 text-[11px] text-slate-500 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-surface-700" />
        <span>Sustaining · no show on-air</span>
      </div>
    )
  }
  return (
    <div className="rounded bg-gradient-to-r from-nar-red/20 to-transparent border border-nar-red/40 px-2 py-1.5 text-[11px] flex items-center gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-nar-red animate-pulse" />
      <span className="font-bold text-white truncate flex-1">{s.currentShow.name}</span>
      <span className="text-slate-400">{s.currentShow.presenter || '—'}</span>
      <button
        onClick={() => s.setCurrentShow(null)}
        className="text-slate-500 hover:text-slate-200 text-[10px]"
        title="Drop the current show (back to sustaining)"
      >
        DROP
      </button>
    </div>
  )
}

/** Inline editor for a single show's production defaults. */
function ShowEditor({ show, onClose }: { show: NarShow; onClose: () => void }) {
  const s = useShows()
  const [draft, setDraft] = useState<NarShow>(show)
  const update = (patch: Partial<NarShow>) => setDraft(d => ({ ...d, ...patch }))
  const save = () => {
    s.updateShow(show.id, draft)
    onClose()
  }

  // Default-templates picker — limit to overlay templates (lower-third, clock,
  // captions, now-playing). Full-screen takeover cards are fired per-event,
  // not as defaults.
  const overlayTemplates = TITLE_TEMPLATES.filter(t => t.group !== 'takeover')

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-surface-900 border border-surface-700 rounded-lg p-4 w-[480px] max-h-[85vh] overflow-auto flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-white uppercase tracking-wider">Edit Show</span>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-sm">×</button>
        </div>

        <label className="block">
          <span className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Show name</span>
          <input
            type="text" value={draft.name}
            onChange={e => update({ name: e.target.value })}
            className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-nar-blue/60"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Presenter</span>
            <input
              type="text" value={draft.presenter}
              onChange={e => update({ presenter: e.target.value })}
              className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-nar-blue/60"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Social</span>
            <input
              type="text" value={draft.social || ''} placeholder="@narradio"
              onChange={e => update({ social: e.target.value })}
              className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-nar-blue/60"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Start time</span>
            <input
              type="text" placeholder="17:00" value={draft.startTime || ''}
              onChange={e => update({ startTime: e.target.value })}
              className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-white font-mono outline-none focus:border-nar-blue/60"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Duration (min)</span>
            <input
              type="number" placeholder="60" value={draft.durationMinutes ?? ''}
              onChange={e => update({ durationMinutes: e.target.value === '' ? undefined : Number(e.target.value) })}
              className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-white tabular-nums outline-none focus:border-nar-blue/60"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Default viz mode</span>
            <select
              value={draft.defaultVizMode ?? ''}
              onChange={e => update({ defaultVizMode: e.target.value === '' ? undefined : Number(e.target.value) })}
              className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-nar-blue/60"
            >
              <option value="">— inherit global —</option>
              {VIZ_MODES.map(m => (
                <option key={m.id} value={m.id}>{m.label} ({m.group})</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Default palette</span>
            <select
              value={draft.defaultVizPalette ?? ''}
              onChange={e => update({ defaultVizPalette: e.target.value === '' ? undefined : Number(e.target.value) })}
              className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-nar-blue/60"
            >
              <option value="">— inherit —</option>
              {VIZ_PALETTES.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Default layout</span>
          <div className="flex gap-1">
            {(['solo', 'split', 'pip'] as LayoutType[]).map(l => (
              <button
                key={l}
                onClick={() => update({ defaultLayout: l })}
                className={`flex-1 text-[10px] py-1 rounded font-bold uppercase tracking-wider transition-colors ${
                  draft.defaultLayout === l
                    ? 'bg-nar-blue text-white'
                    : 'bg-surface-800 text-slate-400 hover:text-white'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </label>

        <fieldset className="border border-surface-800 rounded p-2">
          <legend className="text-[10px] text-slate-500 uppercase tracking-wider px-1">Default overlays · auto-fire at show start</legend>
          <div className="grid grid-cols-2 gap-1 mt-1">
            {overlayTemplates.map(tpl => {
              const on = draft.defaultTitleTemplates?.includes(tpl.template) ?? false
              return (
                <button
                  key={tpl.template}
                  onClick={() => {
                    const cur = draft.defaultTitleTemplates ?? []
                    const next = on ? cur.filter(t => t !== tpl.template) : [...cur, tpl.template]
                    update({ defaultTitleTemplates: next })
                  }}
                  className={`text-[10px] py-1 px-2 rounded text-left transition-colors ${
                    on ? 'bg-nar-amber text-white' : 'bg-surface-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {tpl.label}
                </button>
              )
            })}
          </div>
        </fieldset>

        {/* Sponsor selection */}
        <fieldset className="border border-surface-800 rounded p-2">
          <legend className="text-[10px] text-slate-500 uppercase tracking-wider px-1">Sponsors</legend>
          {s.sponsors.length === 0 ? (
            <div className="text-[10px] text-slate-600 px-1 py-2">
              No sponsors yet. Add some below the show list.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1 mt-1">
              {s.sponsors.map(sp => {
                const on = draft.sponsorIds?.includes(sp.id) ?? false
                return (
                  <button
                    key={sp.id}
                    onClick={() => {
                      const cur = draft.sponsorIds ?? []
                      const next = on ? cur.filter(id => id !== sp.id) : [...cur, sp.id]
                      update({ sponsorIds: next })
                    }}
                    className={`text-[10px] py-1 px-2 rounded transition-colors ${
                      on ? 'bg-nar-amber text-white' : 'bg-surface-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {sp.name}
                  </button>
                )
              })}
            </div>
          )}
        </fieldset>

        {/* Per-show HourClock landmarks — paints dots on the schedule banner's
            dial when this show is on-air. Operators with established hour
            shapes (Drive Time = :00 news / :15 travel / :30 news / :45 travel,
            Weekend Breakfast = :00 ident / :20 sport / :40 review) get to
            see their canonical hour at a glance. */}
        <HourLandmarksEditor
          landmarks={draft.hourLandmarks ?? []}
          onChange={(next) => update({ hourLandmarks: next })}
        />

        <label className="block">
          <span className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Producer notes</span>
          <textarea
            value={draft.description || ''} rows={2}
            onChange={e => update({ description: e.target.value })}
            placeholder="Anything the operator should remember when this show is on-air"
            className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-nar-blue/60 resize-none"
          />
        </label>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="text-xs py-1.5 px-3 rounded bg-surface-800 text-slate-400 hover:text-white">
            Cancel
          </button>
          <button onClick={save} className="text-xs py-1.5 px-3 rounded bg-nar-blue text-white font-bold uppercase tracking-wider">
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

/** Station-wide sponsor library — referenced by shows. */
function SponsorLibrary() {
  const s = useShows()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  return (
    <details className="rounded border border-surface-800 bg-surface-900/50 group">
      <summary className="px-2 py-1.5 text-xs text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300 select-none flex items-center justify-between">
        <span>Sponsor Library · {s.sponsors.length}</span>
        <span className="text-[10px] text-slate-700 group-open:hidden">▾</span>
        <span className="text-[10px] text-slate-700 hidden group-open:inline">▴</span>
      </summary>
      <div className="border-t border-surface-800 p-2 flex flex-col gap-1">
        {s.sponsors.map(sp => (
          <div key={sp.id} className="flex items-center gap-2 text-[11px] bg-surface-800 rounded px-2 py-1">
            <span className="flex-1 truncate text-slate-200">{sp.name}</span>
            <span className="text-slate-600 truncate max-w-[40%]">{sp.tagline || ''}</span>
            <button
              onClick={() => {
                const n = window.prompt('Sponsor name', sp.name)
                if (n) s.updateSponsor(sp.id, { name: n })
              }}
              className="text-slate-500 hover:text-slate-200"
            >✎</button>
            <button
              onClick={() => s.removeSponsor(sp.id)}
              className="text-slate-500 hover:text-nar-red"
            >×</button>
          </div>
        ))}
        {adding ? (
          <div className="flex flex-col gap-1 p-1 bg-surface-800 rounded">
            <input
              type="text" placeholder="Sponsor name" value={name}
              onChange={e => setName(e.target.value)} autoFocus
              className="bg-surface-900 border border-surface-700 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-nar-blue/60"
            />
            <input
              type="text" placeholder="Optional tagline" value={tagline}
              onChange={e => setTagline(e.target.value)}
              className="bg-surface-900 border border-surface-700 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-nar-blue/60"
            />
            <div className="flex gap-1 justify-end">
              <button
                onClick={() => { setAdding(false); setName(''); setTagline('') }}
                className="text-[10px] py-1 px-2 rounded bg-surface-700 text-slate-400"
              >Cancel</button>
              <button
                onClick={() => {
                  if (name.trim()) { s.addSponsor({ name: name.trim(), tagline: tagline.trim() || undefined }) }
                  setName(''); setTagline(''); setAdding(false)
                }}
                className="text-[10px] py-1 px-2 rounded bg-nar-blue text-white font-bold uppercase tracking-wider"
              >Add</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="text-[10px] py-1 rounded bg-surface-800 text-slate-400 hover:text-white"
          >+ Add sponsor</button>
        )}
      </div>
    </details>
  )
}

/** Always-on / sustaining configuration. */
function GlobalStreamSection() {
  const s = useShows()
  const overlayTemplates = TITLE_TEMPLATES.filter(t => t.group === 'takeover')
  return (
    <details className="rounded border border-surface-800 bg-surface-900/50 group">
      <summary className="px-2 py-1.5 text-xs text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300 select-none flex items-center justify-between">
        <span>Global Stream · sustaining + ident</span>
        <span className="text-[10px] text-slate-700 group-open:hidden">▾</span>
        <span className="text-[10px] text-slate-700 hidden group-open:inline">▴</span>
      </summary>
      <div className="border-t border-surface-800 p-2 flex flex-col gap-2">
        <label className="block">
          <span className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Station name</span>
          <input
            type="text" value={s.global.stationName}
            onChange={e => s.setGlobal({ stationName: e.target.value })}
            className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-nar-blue/60"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Sustaining viz (when no show is on)</span>
          <select
            value={s.global.sustainingVizMode}
            onChange={e => s.setGlobal({ sustainingVizMode: Number(e.target.value) })}
            className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-nar-blue/60"
          >
            {VIZ_MODES.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox" checked={s.global.topOfHourIdentEnabled}
            onChange={e => s.setGlobal({ topOfHourIdentEnabled: e.target.checked })}
            className="accent-nar-blue"
          />
          <span className="text-[11px] text-slate-300">Auto-fire station ident at the top of every hour</span>
        </label>
        {s.global.topOfHourIdentEnabled && (
          <div className="grid grid-cols-2 gap-2 pl-5">
            <label className="block">
              <span className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Ident card</span>
              <select
                value={s.global.topOfHourTemplate}
                onChange={e => s.setGlobal({ topOfHourTemplate: e.target.value as any })}
                className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-nar-blue/60"
              >
                {overlayTemplates.map(t => (
                  <option key={t.template} value={t.template}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Hold (sec)</span>
              <input
                type="number" min={2} max={60} value={s.global.topOfHourHoldSeconds}
                onChange={e => s.setGlobal({ topOfHourHoldSeconds: Number(e.target.value) || 8 })}
                className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-white tabular-nums outline-none focus:border-nar-blue/60"
              />
            </label>
          </div>
        )}
      </div>
    </details>
  )
}

/**
 * Myriad MM_TRIGGER UDP bridge — enable / port / live event log.
 * Receive-only today; the binding from event → NAR action ships in a
 * follow-up commit (see the comment block in MyriadBridgeProvider).
 */
function MyriadBridgeSection() {
  const m = useMyriadBridge()
  const [binderOn, setBinderOn] = useMyriadBinderEnabled()
  const [port, setLocalPort] = useState(m.status?.port ?? 5000)
  const [host, setLocalHost] = useState(m.status?.bindHost ?? '0.0.0.0')
  const status = m.status
  const enabled = !!status?.enabled
  const listening = !!status?.listening
  const dot = !enabled
    ? 'bg-surface-700'
    : listening
      ? 'bg-nar-green animate-pulse'
      : 'bg-nar-amber animate-pulse'

  return (
    <details className="rounded border border-surface-800 bg-surface-900/50 group">
      <summary className="px-2 py-1.5 text-xs text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300 select-none flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
          Myriad Bridge · UDP {status?.port ?? 5000}
        </span>
        <span className="text-[10px] text-slate-700 group-open:hidden">▾</span>
        <span className="text-[10px] text-slate-700 hidden group-open:inline">▴</span>
      </summary>
      <div className="border-t border-surface-800 p-2 flex flex-col gap-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox" checked={enabled}
            onChange={e => m.setEnabled(e.target.checked)}
            className="accent-nar-blue"
          />
          <span className="text-[11px] text-slate-300">Receive MM_TRIGGER packets from Myriad</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Bind host</span>
            <input
              type="text" value={host}
              onChange={e => setLocalHost(e.target.value)}
              onBlur={() => host && m.setHost(host)}
              placeholder="0.0.0.0"
              className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs font-mono text-white outline-none focus:border-nar-blue/60"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Port</span>
            <input
              type="number" min={1} max={65535} value={port}
              onChange={e => setLocalPort(Number(e.target.value))}
              onBlur={() => m.setPort(port)}
              className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs font-mono text-white tabular-nums outline-none focus:border-nar-blue/60"
            />
          </label>
        </div>
        {status && (
          <div className="grid grid-cols-3 gap-1 text-[10px] tabular-nums">
            <div className="bg-surface-800 rounded px-2 py-1">
              <div className="text-slate-600 uppercase tracking-wider">In</div>
              <div className="text-slate-300">{status.messagesReceived}</div>
            </div>
            <div className="bg-surface-800 rounded px-2 py-1">
              <div className="text-slate-600 uppercase tracking-wider">Ok</div>
              <div className="text-nar-green">{status.eventsParsed}</div>
            </div>
            <div className="bg-surface-800 rounded px-2 py-1">
              <div className="text-slate-600 uppercase tracking-wider">Err</div>
              <div className={status.parseErrors > 0 ? 'text-nar-amber' : 'text-slate-300'}>
                {status.parseErrors}
              </div>
            </div>
          </div>
        )}
        {m.events.length > 0 ? (
          <div className="flex flex-col gap-0.5 max-h-48 overflow-auto">
            <div className="text-[10px] text-slate-600 uppercase tracking-wider">Recent events</div>
            {m.events.slice(0, 12).map((entry, i) => (
              <div key={i} className="text-[10px] font-mono bg-surface-800 rounded px-2 py-1 flex items-center gap-2">
                <span className="text-slate-600 w-12 shrink-0">
                  {new Date(entry.receivedAt).toLocaleTimeString('en-GB', { hour12: false }).slice(0, 8)}
                </span>
                <span className="text-nar-amber w-20 shrink-0 uppercase">{entry.event.event}</span>
                <span className="text-slate-300 truncate flex-1" title={entry.event.name}>
                  {entry.event.name ?? '—'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          enabled && (
            <div className="text-[10px] text-slate-600 px-1 py-2 leading-snug">
              Waiting for triggers. Configure Myriad's MM_TRIGGER macro to send to <span className="font-mono text-slate-400">UDP {status?.bindHost}:{status?.port}</span>. See <span className="font-mono">docs/myriad-integration.md</span>.
            </div>
          )
        )}
        {/* Event → NAR action binder. When off, the bridge keeps receiving
            + logging but doesn't drive any NAR state. */}
        <label className={`flex items-center gap-2 cursor-pointer p-1.5 rounded ${binderOn ? 'bg-nar-blue/15 border border-nar-blue/40' : 'bg-surface-800 border border-surface-700'}`}>
          <input
            type="checkbox" checked={binderOn}
            onChange={e => setBinderOn(e.target.checked)}
            className="accent-nar-blue"
          />
          <span className="text-[11px] text-slate-200 flex-1">
            Drive NAR from Myriad triggers
          </span>
          {binderOn && <span className="text-[10px] text-nar-blue font-bold uppercase tracking-wider">live</span>}
        </label>
        <div className="text-[10px] text-slate-700 leading-snug">
          When live: <span className="font-mono">show-start</span> → apply show ·
          <span className="font-mono"> advert-start</span> → fire bumper by name ·
          <span className="font-mono"> cart-fire</span> → fire cart by name ·
          <span className="font-mono"> news-start</span> → news card (headline from event) ·
          <span className="font-mono"> travel-start</span> → travel card (route auto-detected) ·
          <span className="font-mono"> item-start</span> → set Now Playing.
          Misses surface as toast warnings.
        </div>
      </div>
    </details>
  )
}

/**
 * HourClock landmark editor — operator builds a list of {minute, label, type}
 * entries that paint dots on the dial whenever this show is on-air. Renders
 * a live preview of the dial alongside the list so the operator sees their
 * edits without leaving the editor.
 */
const LANDMARK_TYPES: MyriadItemType[] = [
  'news', 'travel', 'weather', 'sponsor', 'show', 'voice-track', 'music', 'jingle', 'sweeper', 'other',
]

function HourLandmarksEditor({ landmarks, onChange }: {
  landmarks: HourLandmark[]
  onChange: (next: HourLandmark[]) => void
}) {
  const [newMinute, setNewMinute] = useState(0)
  const [newLabel, setNewLabel] = useState('News')
  const [newType, setNewType] = useState<MyriadItemType>('news')

  const add = () => {
    const minute = Math.max(0, Math.min(59, Math.round(newMinute) || 0))
    const label = newLabel.trim() || MYRIAD_LABELS[newType]
    const id = `lm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    onChange([...landmarks, { id, minute, label, type: newType }].sort((a, b) => a.minute - b.minute))
    setNewLabel('')
  }
  const remove = (id: string) => onChange(landmarks.filter(l => l.id !== id))

  const previewEvents = landmarks.map(l => ({
    minuteOfHour: l.minute,
    color: MYRIAD_COLORS[l.type].hex,
    label: l.label,
  }))

  return (
    <fieldset className="border border-surface-800 rounded p-2">
      <legend className="text-[10px] text-slate-500 uppercase tracking-wider px-1">Hour shape · clock landmarks</legend>
      <div className="flex items-start gap-3 mt-1">
        {/* Live preview dial */}
        <div className="shrink-0">
          <HourClock size={70} events={previewEvents} showSecondHand={false} />
        </div>
        {/* List + add row */}
        <div className="flex-1 flex flex-col gap-1 min-w-0">
          {landmarks.length === 0 ? (
            <div className="text-[10px] text-slate-600 leading-snug">
              No landmarks. Add :00 News, :15 Travel etc to give this show its own canonical hour shape.
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {[...landmarks].sort((a, b) => a.minute - b.minute).map(l => (
                <div key={l.id} className="flex items-center gap-1.5 bg-surface-800/60 rounded px-1.5 py-0.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: MYRIAD_COLORS[l.type].hex }}
                  />
                  <span className="text-[10px] font-mono tabular-nums text-slate-300 w-7 shrink-0">
                    :{l.minute.toString().padStart(2, '0')}
                  </span>
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded ${MYRIAD_COLORS[l.type].bgFaded} ${MYRIAD_COLORS[l.type].textOnFaded} shrink-0`}>
                    {MYRIAD_LABELS[l.type]}
                  </span>
                  <span className="text-[11px] text-slate-300 truncate flex-1">{l.label}</span>
                  <button
                    onClick={() => remove(l.id)}
                    className="text-[10px] text-slate-500 hover:text-nar-red px-1 shrink-0"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* Add row */}
          <div className="flex items-center gap-1 mt-1">
            <input
              type="number" min={0} max={59} value={newMinute}
              onChange={e => setNewMinute(Number(e.target.value))}
              className="w-12 bg-surface-800 border border-surface-700 rounded px-1 py-0.5 text-[11px] font-mono text-white tabular-nums outline-none focus:border-nar-blue/60"
              placeholder=":mm"
            />
            <select
              value={newType}
              onChange={e => setNewType(e.target.value as MyriadItemType)}
              className="bg-surface-800 border border-surface-700 rounded px-1 py-0.5 text-[10px] text-white outline-none focus:border-nar-blue/60"
            >
              {LANDMARK_TYPES.map(t => (
                <option key={t} value={t}>{MYRIAD_LABELS[t]}</option>
              ))}
            </select>
            <input
              type="text" value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              placeholder="Label"
              className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-0.5 text-[11px] text-white outline-none focus:border-nar-blue/60"
            />
            <button
              onClick={add}
              disabled={newMinute < 0 || newMinute > 59}
              className="text-[10px] py-0.5 px-2 rounded bg-nar-blue text-white font-bold uppercase tracking-wider disabled:bg-surface-800 disabled:text-slate-600"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </fieldset>
  )
}
