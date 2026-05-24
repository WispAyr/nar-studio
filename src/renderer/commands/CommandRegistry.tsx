import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react'

/**
 * A single invocable action exposed through the command palette.
 *
 * Anything callable from the operator surface — cut to a camera, swap a
 * viz mode, drop a CG, sweep the compliance folder — registers a command.
 * The palette becomes the keyboard-only escape hatch when the mouse path
 * is too slow.
 */
export interface Command {
  /** Stable identifier. Re-registering with the same id replaces the entry. */
  id: string
  /** Primary human-readable label, shown bold in the palette row. */
  label: string
  /** Optional context: where it lives, what it does, slate-500 right column. */
  hint?: string
  /**
   * Optional global hotkey, e.g. `"ctrl+l"`, `"shift+r"`, `"v"`.
   * Matched case-insensitive on `e.key`. Modifiers must match exactly:
   * any of `ctrl`, `cmd`/`meta`, `shift`, `alt` listed in the string is
   * required; any unlisted modifier must be absent.
   */
  hotkey?: string
  /** Optional grouping — rendered as a non-clickable header in the palette. */
  group?: string
  /** Side effect. May be async; the registry awaits the returned promise. */
  run: () => void | Promise<void>
}

interface CommandRegistryCtx {
  /** Sorted snapshot, group then label. Stable across no-op updates. */
  commands: Command[]
  /** Register a command. Returns an unregister fn — call on unmount. */
  register: (cmd: Command) => () => void
  /** Programmatically fire a command by id. No-op if unknown. */
  run: (id: string) => void | Promise<void>
  /** Fire an already-resolved command — used by the palette. */
  runCommand: (cmd: Command) => void | Promise<void>
}

const Ctx = createContext<CommandRegistryCtx | null>(null)

/**
 * Parse a hotkey spec like `"ctrl+shift+k"` into a normalized matcher.
 * `key` is matched case-insensitive against `KeyboardEvent.key`; modifiers
 * are required if listed and forbidden if not — so `"v"` won't fire when
 * `Ctrl-V` is pressed.
 */
interface ParsedHotkey {
  key: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

function parseHotkey(spec: string): ParsedHotkey | null {
  const parts = spec
    .toLowerCase()
    .split('+')
    .map(p => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  let ctrl = false
  let meta = false
  let shift = false
  let alt = false
  let key = ''
  for (const p of parts) {
    if (p === 'ctrl' || p === 'control') ctrl = true
    else if (p === 'cmd' || p === 'meta' || p === 'command') meta = true
    else if (p === 'shift') shift = true
    else if (p === 'alt' || p === 'option') alt = true
    else key = p
  }
  if (!key) return null
  return { key, ctrl, meta, shift, alt }
}

function matchesHotkey(parsed: ParsedHotkey, e: KeyboardEvent): boolean {
  if (e.key.toLowerCase() !== parsed.key) return false
  if (!!e.ctrlKey !== parsed.ctrl) return false
  if (!!e.metaKey !== parsed.meta) return false
  if (!!e.shiftKey !== parsed.shift) return false
  if (!!e.altKey !== parsed.alt) return false
  return true
}

/**
 * Should we swallow a hotkey when the operator is typing into a text field?
 * Yes — we never want a stray `v` to fire a cut while they're editing a CG.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

/**
 * Holds every registered command and exposes them as a sorted array plus a
 * `register`/`run` API. The provider also installs a window-level keydown
 * listener that fires any command whose `hotkey` matches — so callers get
 * palette discoverability and global hotkeys from the same registration.
 */
export function CommandRegistryProvider({ children }: { children: ReactNode }) {
  // Internal source of truth — id -> Command. We bump `version` to publish
  // immutable snapshots to the React tree without ever exposing the map.
  const mapRef = useRef<Map<string, Command>>(new Map())
  const [version, setVersion] = useState(0)

  const register = useCallback((cmd: Command) => {
    mapRef.current.set(cmd.id, cmd)
    setVersion(v => v + 1)
    return () => {
      const m = mapRef.current
      // Only delete if we still own the entry — guards against unmount
      // ordering replacing-then-deleting a fresh registration.
      if (m.get(cmd.id) === cmd) {
        m.delete(cmd.id)
        setVersion(v => v + 1)
      }
    }
  }, [])

  const runCommand = useCallback((cmd: Command): void | Promise<void> => {
    try {
      const r = cmd.run()
      if (r && typeof (r as Promise<void>).then === 'function') {
        return (r as Promise<void>).catch(err => {
          console.error(`[commands] "${cmd.id}" failed:`, err)
        })
      }
    } catch (err) {
      console.error(`[commands] "${cmd.id}" failed:`, err)
    }
    return undefined
  }, [])

  const run = useCallback((id: string): void | Promise<void> => {
    const cmd = mapRef.current.get(id)
    if (!cmd) return undefined
    return runCommand(cmd)
  }, [runCommand])

  // Sorted snapshot — group first (commands without a group sink to the
  // bottom), then label. Stable across renders so consumers can use it as
  // a dependency without thrashing.
  const commands = useMemo(() => {
    void version
    const arr = Array.from(mapRef.current.values())
    arr.sort((a, b) => {
      const ag = a.group ?? '￿'
      const bg = b.group ?? '￿'
      if (ag !== bg) return ag.localeCompare(bg)
      return a.label.localeCompare(b.label)
    })
    return arr
  }, [version])

  // Global hotkey dispatch. Lives in the provider rather than the palette
  // so hotkeys still fire when the palette is closed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      // Walk the current map — cheap, and avoids racing against `version`.
      for (const cmd of mapRef.current.values()) {
        if (!cmd.hotkey) continue
        const parsed = parseHotkey(cmd.hotkey)
        if (!parsed) continue
        if (matchesHotkey(parsed, e)) {
          e.preventDefault()
          runCommand(cmd)
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runCommand])

  const value = useMemo<CommandRegistryCtx>(
    () => ({ commands, register, run, runCommand }),
    [commands, register, run, runCommand],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCommandRegistry() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCommandRegistry must be used inside CommandRegistryProvider')
  return ctx
}
