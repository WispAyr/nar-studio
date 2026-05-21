import { useState } from 'react'
import { useStreamDeck } from '../../streamdeck/StreamDeckProvider'
import { DECK_ACTIONS, getAction } from '../../streamdeck/actions'

const GROUPS = ['Cameras', 'Program', 'Director'] as const

/**
 * Stream Deck customisation page — lay out what each key does. The grid
 * mirrors the connected deck (or a standard 15-key layout when none is
 * attached); tap a key, then pick an action to bind it.
 */
export function StreamDeckView({ onExit }: { onExit: () => void }) {
  const { status, deck, bindings, setBinding, connect, disconnect, error } = useStreamDeck()
  const [selected, setSelected] = useState<number | null>(null)

  const keyCount = deck?.keys ?? 15
  const columns = deck?.columns ?? 5

  return (
    <div className="flex flex-col h-screen bg-surface-950 overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-3 px-3 h-11 shrink-0 bg-surface-900 border-b border-surface-700">
        <button
          onClick={onExit}
          className="text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-white transition-colors"
        >
          ‹ Switcher
        </button>
        <span className="text-xs font-bold tracking-wider text-slate-200">STREAM DECK</span>
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
            status === 'connected' ? 'bg-nar-green/20 text-nar-green'
              : status === 'connecting' ? 'bg-nar-amber/20 text-nar-amber'
              : 'bg-surface-700 text-slate-500'
          }`}
        >
          {status === 'connected' ? (deck?.model ?? 'Connected')
            : status === 'connecting' ? 'Connecting…'
            : 'Not connected'}
        </span>
        {error && <span className="text-[10px] text-nar-red">{error}</span>}
        <div className="ml-auto">
          {status === 'connected' ? (
            <button
              onClick={disconnect}
              className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-surface-700 text-slate-400 hover:text-white transition-colors"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={connect}
              className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-nar-blue text-white hover:bg-blue-600 transition-colors"
            >
              Connect Stream Deck
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 gap-1 p-1">

        {/* Key grid */}
        <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-4 bg-surface-900 rounded border border-surface-700">
          <span className="text-xs text-slate-500 uppercase tracking-wider">
            {status === 'connected'
              ? 'Tap a key, then pick an action'
              : 'Lay out your keys — connect a deck to go live'}
          </span>
          <div className="grid gap-2 p-3 rounded-lg bg-black/40" style={{ gridTemplateColumns: `repeat(${columns}, 64px)` }}>
            {Array.from({ length: keyCount }, (_, i) => {
              const action = getAction(bindings[i])
              const sel = selected === i
              return (
                <button
                  key={i}
                  onClick={() => setSelected(i)}
                  className={`w-16 h-16 rounded flex items-center justify-center text-center p-1 transition-all ${
                    sel ? 'ring-2 ring-white scale-105' : 'ring-1 ring-surface-700 hover:ring-surface-500'
                  }`}
                  style={{ background: action?.color ?? '#15151a' }}
                >
                  <span className="text-[10px] font-bold text-white leading-tight whitespace-pre-line">
                    {action?.label ?? ''}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Action palette */}
        <div className="w-72 shrink-0 bg-surface-900 rounded border border-surface-700 flex flex-col">
          <div className="px-3 py-2 border-b border-surface-700 shrink-0">
            <span className="text-xs font-bold tracking-wider text-slate-300">
              {selected != null ? `KEY ${selected + 1}` : 'ACTIONS'}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
            {selected == null && (
              <span className="text-[11px] text-slate-600">Select a key on the left to assign an action.</span>
            )}
            {selected != null && (
              <>
                <button
                  onClick={() => setBinding(selected, null)}
                  className="text-xs py-1.5 rounded bg-surface-700 text-slate-400 hover:bg-nar-red hover:text-white transition-colors"
                >
                  Clear key
                </button>
                {GROUPS.map(group => (
                  <section key={group} className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wider text-slate-600">{group}</span>
                    {DECK_ACTIONS.filter(a => a.group === group).map(a => (
                      <button
                        key={a.id}
                        onClick={() => setBinding(selected, a.id)}
                        className={`flex items-center gap-2 text-xs py-1.5 px-2 rounded transition-colors ${
                          bindings[selected] === a.id
                            ? 'bg-surface-700 text-white'
                            : 'bg-surface-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: a.color }} />
                        {a.label.replace('\n', ' ')}
                      </button>
                    ))}
                  </section>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
