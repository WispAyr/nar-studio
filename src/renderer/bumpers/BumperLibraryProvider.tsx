import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import { useEngine } from '../engine/EngineProvider'

/**
 * Bumper library / video sting deck.
 *
 * Companion to the cart wall: where the cart wall fires short audio stings
 * onto the broadcast bus, the bumper library fires *full-screen* video stings
 * that take over the program canvas via the engine's `rollBumper(url, label)`
 * API. The engine plays the video to completion and the operator cuts back to
 * cameras manually (or calls `stopBumper()` to abort).
 *
 * Persistence — IMPORTANT LIMITATION:
 * We store the resolved blob URL (from `URL.createObjectURL(file)`) alongside
 * the label / hotkey / colour. Blob URLs do NOT survive a window reload — the
 * browser revokes them when the originating document goes away — so on a
 * fresh app start the entries persist with a dead `url`. The Panel surfaces
 * this with a warning banner and the operator re-adds files for the session.
 *
 * TODO(bumper-library/v2): wire a main-process file-path picker via
 * `dialog.showOpenDialog` and stream the file off disk through a custom
 * protocol (e.g. `nar-file://...`) so layouts survive a restart end-to-end.
 *
 * Design lifted directly from `CartWallProvider`: same persistence pattern,
 * same global-keydown hotkey listener, same input-aware skip rule.
 */

export const NAR_BRAND_COLORS = [
  '#e5202b', // nar-red
  '#f7931e', // nar-amber
  '#facc15', // accent yellow
  '#22c55e', // nar-green
  '#3b82f6', // nar-blue
  '#7c5cff', // violet
  '#ec4899', // pink
  '#94a3b8', // slate
] as const

const LS_KEY = 'nar-bumper-library'

export interface BumperEntry {
  id: string
  label: string
  /**
   * URL the engine will load. Today this is a `URL.createObjectURL(file)` blob
   * URL or, occasionally, a data URL the operator pasted in. Blob URLs die on
   * reload — see provider header note.
   */
  url: string
  /** Single-key shortcut, e.g. "1", "q", "F1". Case-insensitive. */
  hotkey: string | null
  color: string
}

interface BumperLibraryCtx {
  bumpers: BumperEntry[]
  /** True while the engine is currently playing a bumper. */
  isPlaying: boolean
  addFile: (file: File, label?: string) => void
  remove: (id: string) => void
  setLabel: (id: string, label: string) => void
  setHotkey: (id: string, key: string | null) => void
  setColor: (id: string, color: string) => void
  fire: (id: string) => void
  stop: () => void
}

const Ctx = createContext<BumperLibraryCtx | null>(null)

function loadBumpers(): BumperEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Partial<BumperEntry>[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((b): b is BumperEntry =>
        !!b && typeof b.id === 'string'
        && typeof b.label === 'string'
        && typeof b.url === 'string'
        && typeof b.color === 'string',
      )
      .map((b, i) => ({
        id: b.id,
        label: b.label,
        url: b.url,
        hotkey: typeof b.hotkey === 'string' && b.hotkey.length > 0 ? b.hotkey : null,
        color: b.color || NAR_BRAND_COLORS[i % NAR_BRAND_COLORS.length],
      }))
  } catch {
    return []
  }
}

function saveBumpers(bumpers: BumperEntry[]) {
  try {
    // We persist the URL even though blob URLs go stale on reload — keeping
    // the slot row visible (with its label / hotkey / colour) is still useful
    // because the operator can see "ah, I had X bound to key 1" and re-add.
    localStorage.setItem(LS_KEY, JSON.stringify(bumpers))
  } catch { /* quota / disabled — non-fatal */ }
}

function normaliseHotkey(key: string): string {
  if (/^F\d+$/i.test(key)) return key.toUpperCase()
  return key.length === 1 ? key.toLowerCase() : key
}

function deriveLabel(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || filename
}

function makeId(): string {
  // Crypto.randomUUID is broadly available in Electron's Chromium; falling
  // back to a timestamp+random combo if a host strips it.
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch { /* ignore */ }
  return `bumper-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function BumperLibraryProvider({ children }: { children: ReactNode }) {
  const engine = useEngine()
  const [bumpers, setBumpers] = useState<BumperEntry[]>(loadBumpers)

  // Snapshot ref for the global keydown listener — avoids stale closures while
  // letting the listener stay attached for the provider's lifetime.
  const bumpersRef = useRef(bumpers)
  bumpersRef.current = bumpers

  // Persist on every change. JSON of a handful of small objects, very cheap.
  useEffect(() => { saveBumpers(bumpers) }, [bumpers])

  const fire = useCallback((id: string) => {
    const b = bumpersRef.current.find(x => x.id === id)
    if (!b) return
    if (!b.url) return
    engine.rollBumper(b.url, b.label)
  }, [engine])

  const stop = useCallback(() => {
    engine.stopBumper()
  }, [engine])

  const addFile = useCallback((file: File, label?: string) => {
    // Blob URL is the only practical option from a browser File handle today;
    // see the provider header for the file-path roadmap.
    const url = URL.createObjectURL(file)
    setBumpers(prev => {
      const entry: BumperEntry = {
        id: makeId(),
        label: label ?? deriveLabel(file.name),
        url,
        hotkey: null,
        color: NAR_BRAND_COLORS[prev.length % NAR_BRAND_COLORS.length],
      }
      return [...prev, entry]
    })
  }, [])

  const remove = useCallback((id: string) => {
    setBumpers(prev => {
      const victim = prev.find(b => b.id === id)
      if (victim && victim.url.startsWith('blob:')) {
        // Free the underlying blob — the browser holds the File in memory
        // until every URL handle to it is revoked.
        try { URL.revokeObjectURL(victim.url) } catch { /* ignore */ }
      }
      return prev.filter(b => b.id !== id)
    })
  }, [])

  const setLabel = useCallback((id: string, label: string) => {
    setBumpers(prev => prev.map(b => b.id === id ? { ...b, label } : b))
  }, [])

  const setHotkey = useCallback((id: string, key: string | null) => {
    const next = key && key.length > 0 ? normaliseHotkey(key) : null
    // Steal the hotkey from any other bumper holding it — same rule the cart
    // wall uses, two slots on one key is just confusing.
    setBumpers(prev => prev.map(b => {
      if (b.id === id) return { ...b, hotkey: next }
      if (next && b.hotkey && normaliseHotkey(b.hotkey) === next) return { ...b, hotkey: null }
      return b
    }))
  }, [])

  const setColor = useCallback((id: string, color: string) => {
    setBumpers(prev => prev.map(b => b.id === id ? { ...b, color } : b))
  }, [])

  // Global keyboard handler. Mirrors the cart wall's behaviour: skip when a
  // text input / contenteditable owns focus, skip modifier-laden combos, only
  // fire bumpers whose URL is non-empty (dead post-reload entries do nothing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      const el = document.activeElement as HTMLElement | null
      if (el) {
        const tag = el.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const pressed = normaliseHotkey(e.key)
      const hit = bumpersRef.current.find(b => b.hotkey && normaliseHotkey(b.hotkey) === pressed)
      if (!hit) return
      if (!hit.url) return
      e.preventDefault()
      fire(hit.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fire])

  // On unmount, revoke any blob URLs we own so a hot-reload doesn't leak.
  // The bumpers themselves are persisted; the URLs are recreated next session.
  useEffect(() => () => {
    bumpersRef.current.forEach(b => {
      if (b.url.startsWith('blob:')) {
        try { URL.revokeObjectURL(b.url) } catch { /* ignore */ }
      }
    })
  }, [])

  const isPlaying = engine.bumper !== null

  const value = useMemo<BumperLibraryCtx>(() => ({
    bumpers,
    isPlaying,
    addFile, remove,
    setLabel, setHotkey, setColor,
    fire, stop,
  }), [bumpers, isPlaying, addFile, remove, setLabel, setHotkey, setColor, fire, stop])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useBumperLibrary() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useBumperLibrary must be used inside BumperLibraryProvider')
  return ctx
}
