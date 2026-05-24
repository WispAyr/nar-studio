import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useCommandRegistry, type Command } from './CommandRegistry'

/**
 * Ctrl-K / Cmd-K command palette.
 *
 * Tonally calm: a single dark surface with a soft amber accent on the
 * matched characters. No animation past a fade-in, no spinning rainbows —
 * an operator hitting this is usually mid-show and stressed.
 */

interface Match {
  cmd: Command
  /** Indices into label of the characters that matched the query. */
  indices: number[]
  /** Lower = better. */
  score: number
}

/**
 * Fuzzy subsequence matcher.
 *
 * Walks the query letter by letter through the haystack, allowing skips
 * but rewarding tightness and early hits. Returns the matched indices into
 * `label` (for highlight rendering) and a score where smaller is better.
 *
 * We search across `label + hint + group` but only return indices that
 * fall inside the label region, so the visual highlight only ever decorates
 * the bold label.
 */
function fuzzyScore(query: string, label: string, hint?: string, group?: string): Match['indices'] | null {
  if (!query) return []
  const q = query.toLowerCase()
  const labelLower = label.toLowerCase()
  const haystack = `${labelLower}\x1f${(hint ?? '').toLowerCase()}\x1f${(group ?? '').toLowerCase()}`
  const indices: number[] = []
  let hi = 0
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    let found = -1
    while (hi < haystack.length) {
      if (haystack[hi] === ch) {
        found = hi
        hi++
        break
      }
      hi++
    }
    if (found < 0) return null
    if (found < labelLower.length) indices.push(found)
  }
  return indices
}

function scoreMatch(query: string, label: string, hint?: string, group?: string): Match | null {
  const cmdLike = { label, hint, group } as Command
  const indices = fuzzyScore(query, label, hint, group)
  if (indices === null) return null
  // Tightness: gaps between consecutive label hits.
  let gap = 0
  for (let i = 1; i < indices.length; i++) gap += indices[i] - indices[i - 1] - 1
  // Earliness: index of first hit (lower is better).
  const first = indices.length > 0 ? indices[0] : label.length
  // Hits in the label are worth more than hits absorbed by hint/group.
  const labelHitBonus = indices.length === 0 ? 5 : 0
  const score = gap * 2 + first + labelHitBonus + label.length * 0.01
  return { cmd: cmdLike, indices, score }
}

/** Render a label with matched character indices highlighted. */
function HighlightedLabel({ label, indices }: { label: string; indices: number[] }) {
  if (indices.length === 0) return <>{label}</>
  const set = new Set(indices)
  const out: JSX.Element[] = []
  let buf = ''
  for (let i = 0; i < label.length; i++) {
    if (set.has(i)) {
      if (buf) {
        out.push(<span key={`p${i}`}>{buf}</span>)
        buf = ''
      }
      out.push(
        <span key={`h${i}`} className="text-nar-amber font-semibold">
          {label[i]}
        </span>,
      )
    } else {
      buf += label[i]
    }
  }
  if (buf) out.push(<span key="tail">{buf}</span>)
  return <>{out}</>
}

/** Pretty-print a hotkey spec like `"ctrl+shift+k"` -> `Ctrl Shift K`. */
function formatHotkey(spec: string): string {
  return spec
    .split('+')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      const l = p.toLowerCase()
      if (l === 'ctrl' || l === 'control') return 'Ctrl'
      if (l === 'cmd' || l === 'meta' || l === 'command') return '⌘'
      if (l === 'shift') return 'Shift'
      if (l === 'alt' || l === 'option') return 'Alt'
      return p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)
    })
    .join(' ')
}

/**
 * One row in the result list. Either a non-clickable group header or a
 * selectable command row. Pulled out so we can pass refs into a flat array
 * indexed by visual position for scroll-into-view.
 */
type Row =
  | { kind: 'header'; group: string; key: string }
  | { kind: 'cmd'; match: Match; key: string; cmdIndex: number }

export function CommandPalette() {
  const { commands, runCommand } = useCommandRegistry()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

  // Open on Ctrl-K / Cmd-K, close on Escape. Both at window level so the
  // palette is reachable from anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
        return
      }
      if (open && e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Reset transient state whenever we close.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setHighlight(0)
    }
  }, [open])

  // Auto-focus the input on open. Use a layout effect so the focus lands
  // before the first paint and the operator can just start typing.
  useLayoutEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Build the filtered + sorted match list. `commands` is already sorted
  // by (group, label) so we keep that order while query is empty.
  const matches = useMemo<Match[]>(() => {
    if (!query) {
      return commands.map(cmd => ({ cmd, indices: [], score: 0 }))
    }
    const out: Match[] = []
    for (const cmd of commands) {
      const m = scoreMatch(query, cmd.label, cmd.hint, cmd.group)
      if (m) out.push({ cmd, indices: m.indices, score: m.score })
    }
    out.sort((a, b) => a.score - b.score)
    return out
  }, [commands, query])

  // Flatten matches into renderable rows with group headers. cmdIndex is
  // the position in the *selectable* list (skipping headers).
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    let lastGroup: string | undefined = undefined
    let cmdIndex = 0
    for (const m of matches) {
      const g = m.cmd.group
      // While typing, headers are noisy — only show group headers when
      // the query is empty so the result list stays scannable.
      if (!query && g && g !== lastGroup) {
        out.push({ kind: 'header', group: g, key: `g:${g}` })
        lastGroup = g
      }
      out.push({ kind: 'cmd', match: m, key: `c:${m.cmd.id}`, cmdIndex })
      cmdIndex++
    }
    return out
  }, [matches, query])

  // Clamp highlight to the number of selectable commands.
  useEffect(() => {
    if (highlight >= matches.length && matches.length > 0) setHighlight(matches.length - 1)
    if (highlight < 0) setHighlight(0)
  }, [matches.length, highlight])

  // Reset highlight to the top when the query changes — the best match
  // moved, so the operator's current cursor is no longer meaningful.
  useEffect(() => {
    setHighlight(0)
  }, [query])

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    const el = rowRefs.current.get(highlight)
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [highlight, rows])

  const close = useCallback(() => setOpen(false), [])

  const fire = useCallback(
    (cmd: Command) => {
      close()
      // Defer one tick so the close state has settled before any side
      // effect that might open another modal.
      Promise.resolve().then(() => runCommand(cmd))
    },
    [close, runCommand],
  )

  const onInputKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault()
        setHighlight(h => Math.min(matches.length - 1, h + 1))
      } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault()
        setHighlight(h => Math.max(0, h - 1))
      } else if (e.key === 'Home') {
        e.preventDefault()
        setHighlight(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        setHighlight(Math.max(0, matches.length - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const m = matches[highlight]
        if (m) fire(m.cmd)
      }
    },
    [matches, highlight, fire],
  )

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 backdrop-blur-sm pt-[12vh]"
      onMouseDown={e => {
        // Click on the backdrop closes; clicks inside the card don't bubble here.
        if (e.target === e.currentTarget) close()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-[640px] max-w-[92vw] max-h-[480px] flex flex-col bg-surface-900 border border-white/15 rounded-lg shadow-2xl overflow-hidden"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-700">
          <span className="text-xs text-slate-600 uppercase tracking-wider font-bold">⌘K</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Type a command…"
            spellCheck={false}
            autoComplete="off"
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-600 outline-none py-1"
          />
          <span className="text-[10px] text-slate-700 tabular-nums shrink-0">
            {matches.length} {matches.length === 1 ? 'cmd' : 'cmds'}
          </span>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto py-1">
          {rows.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-slate-600">No matches</div>
          ) : (
            rows.map(row => {
              if (row.kind === 'header') {
                return (
                  <div
                    key={row.key}
                    className="px-3 pt-2 pb-1 text-[10px] text-slate-600 uppercase tracking-wider font-bold select-none"
                  >
                    {row.group}
                  </div>
                )
              }
              const { match, cmdIndex } = row
              const cmd = match.cmd
              const active = cmdIndex === highlight
              return (
                <button
                  key={row.key}
                  ref={el => {
                    if (el) rowRefs.current.set(cmdIndex, el)
                    else rowRefs.current.delete(cmdIndex)
                  }}
                  type="button"
                  onMouseMove={() => {
                    if (cmdIndex !== highlight) setHighlight(cmdIndex)
                  }}
                  onMouseDown={e => e.preventDefault()} // keep input focus
                  onClick={() => fire(cmd)}
                  className={`w-full flex items-center gap-3 px-3 py-1.5 text-left text-sm transition-colors ${
                    active ? 'bg-nar-blue text-white' : 'text-slate-300 hover:bg-surface-800'
                  }`}
                >
                  <span className="flex-1 truncate font-bold">
                    <HighlightedLabel label={cmd.label} indices={match.indices} />
                  </span>
                  {cmd.hint && (
                    <span
                      className={`text-xs truncate max-w-[40%] ${
                        active ? 'text-white/70' : 'text-slate-500'
                      }`}
                    >
                      {cmd.hint}
                    </span>
                  )}
                  {cmd.hotkey && (
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border tabular-nums shrink-0 ${
                        active
                          ? 'border-white/40 text-white/90'
                          : 'border-surface-600 text-slate-500'
                      }`}
                    >
                      {formatHotkey(cmd.hotkey)}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-between px-3 py-1.5 border-t border-surface-700 text-[10px] text-slate-600 tabular-nums">
          <span>↑ ↓ navigate · ↵ run · Esc close</span>
          <span>NAR Command Palette</span>
        </div>
      </div>
    </div>
  )
}
