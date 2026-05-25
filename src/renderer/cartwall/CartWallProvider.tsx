import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import type { MyriadItemType } from '../components/common/itemTypeColors'

/**
 * Cart wall / sting deck.
 *
 * A 16-slot soundboard for hot-firing stings, jingles, ID sweepers and
 * sponsor mentions over the broadcast bus. Lives in its own AudioContext so
 * it stays independent of the broadcast capture chain, and exposes:
 *
 *   getOutputNode()   — GainNode in the cartwall's AudioContext. Useful only
 *                       inside that context (e.g. monitoring locally).
 *   getOutputStream() — A MediaStream tap of the same node. This is the
 *                       cross-context bridge: the broadcast chain (running in
 *                       its own AudioContext) can wrap this in a
 *                       MediaStreamSource and sum it pre-compressor so cart
 *                       fires are processed alongside the mic.
 *   getAudioContext() — The underlying AudioContext, in case external wiring
 *                       wants to inspect sampleRate / state.
 *
 * Why a stream as the public hand-off: WebAudio nodes can't be wired across
 * AudioContext instances directly. MediaStream is the supported bridge, and
 * the broadcast provider already consumes one for its mic.
 *
 * Slot configuration (label / hotkey / colour / source file path) persists to
 * localStorage. The actual audio data is NOT persisted — browser blob URLs
 * don't survive a reload, so files must be re-picked next session. The picker
 * UI handles that with a clearly-marked "missing" state.
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

const LS_KEY = 'nar-cartwall'
const LS_KEY_GROUP = 'nar-cartwall-group'
const SLOT_COUNT = 16

export interface CartSlot {
  id: string
  label: string
  /** Source file path / name. Used as a display hint after reload. */
  filePath: string | null
  /** Single-key shortcut, e.g. "1", "q", "F1". Case-insensitive. */
  hotkey: string | null
  color: string
  /**
   * Myriad item type — drives the tile's faded background tint and the type
   * chip in the editor. Mirrors Myriad Playout's vocabulary so operators get
   * the same colour cues across systems. Defaults to `'jingle'` (the most
   * common cart-wall occupant).
   */
  type: MyriadItemType
}

/** Persisted view of a slot — everything except runtime audio buffers. */
type PersistedSlot = Pick<CartSlot, 'id' | 'label' | 'filePath' | 'hotkey' | 'color' | 'type'>

interface CartWallCtx {
  slots: CartSlot[]
  /** Set of slot ids that are currently flashing (just-fired indicator). */
  flashing: ReadonlySet<string>
  /** Set of slot ids whose audio buffer is loaded and ready to fire. */
  ready: ReadonlySet<string>
  fire: (id: string) => void
  /**
   * Fire the first ready slot whose label matches `name` (case-insensitive,
   * substring fallback). Used by the Myriad bridge to route `cart-fire`
   * events. Returns true if a slot was fired, false otherwise.
   */
  fireByName: (name: string) => boolean
  assign: (id: string, file: File) => Promise<void>
  clear: (id: string) => void
  setLabel: (id: string, label: string) => void
  setHotkey: (id: string, key: string | null) => void
  setColor: (id: string, color: string) => void
  setType: (id: string, type: MyriadItemType) => void
  /**
   * Operator view preference — when true, the panel renders slots grouped
   * under per-type section headers instead of the raw 4×4 positional grid.
   * Persisted so the choice survives reloads. The slot order itself never
   * changes — this is purely a render-time reorder.
   */
  groupByType: boolean
  setGroupByType: (on: boolean) => void
  /** Underlying audio output node — connect to the broadcast chain. */
  getOutputNode: () => AudioNode | null
  /** MediaStream tap of the output, suitable for cross-context wiring. */
  getOutputStream: () => MediaStream | null
  /** AudioContext owned by this provider. */
  getAudioContext: () => AudioContext | null
}

const Ctx = createContext<CartWallCtx | null>(null)

/** Default type for newly-created or freshly-migrated slots. Jingles are the
 * most common cart-wall occupant on every station we've shipped to. */
const DEFAULT_SLOT_TYPE: MyriadItemType = 'jingle'

/** Item types that may legally appear on a cart slot. Container types
 * (show / interview / ad-break) are excluded — those are rundown-level
 * concepts, not single-fire stings. Kept here as a runtime guard for the
 * localStorage migration path. */
const ALLOWED_SLOT_TYPES: ReadonlySet<MyriadItemType> = new Set<MyriadItemType>([
  'music', 'jingle', 'sweeper', 'voice-track', 'advert',
  'sponsor', 'news', 'travel', 'weather', 'other',
])

function defaultSlots(): CartSlot[] {
  return Array.from({ length: SLOT_COUNT }, (_, i) => ({
    id: `slot-${i}`,
    label: `Cart ${i + 1}`,
    filePath: null,
    hotkey: null,
    color: NAR_BRAND_COLORS[i % NAR_BRAND_COLORS.length],
    type: DEFAULT_SLOT_TYPE,
  }))
}

function loadSlots(): CartSlot[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return defaultSlots()
    const parsed = JSON.parse(raw) as Partial<PersistedSlot>[]
    if (!Array.isArray(parsed)) return defaultSlots()
    const base = defaultSlots()
    // Merge persisted entries into the default skeleton so slot count + ids
    // are always consistent even if the storage shape drifts.
    for (let i = 0; i < base.length; i++) {
      const p = parsed[i]
      if (!p) continue
      // Migration: pre-type-field saves won't have `type`. Default those to
      // jingle so an upgrade doesn't lose carts. Anything that does have a
      // type is validated against the allow-list — Myriad container types
      // (show / interview / ad-break) get coerced to the default since they
      // don't make sense on a single cart slot.
      const persistedType = p.type
      const validType: MyriadItemType =
        typeof persistedType === 'string' && ALLOWED_SLOT_TYPES.has(persistedType as MyriadItemType)
          ? persistedType as MyriadItemType
          : DEFAULT_SLOT_TYPE
      base[i] = {
        ...base[i],
        label: typeof p.label === 'string' ? p.label : base[i].label,
        filePath: typeof p.filePath === 'string' ? p.filePath : null,
        hotkey: typeof p.hotkey === 'string' && p.hotkey.length > 0 ? p.hotkey : null,
        color: typeof p.color === 'string' ? p.color : base[i].color,
        type: validType,
      }
    }
    return base
  } catch {
    return defaultSlots()
  }
}

function saveSlots(slots: CartSlot[]) {
  try {
    const persisted: PersistedSlot[] = slots.map(s => ({
      id: s.id, label: s.label, filePath: s.filePath, hotkey: s.hotkey, color: s.color, type: s.type,
    }))
    localStorage.setItem(LS_KEY, JSON.stringify(persisted))
  } catch { /* quota / disabled — non-fatal */ }
}

/** Restore the operator's grouping preference. Stored as a literal `'on'`
 * string so the absence of the key — or any other value — falls back to the
 * default (grid mode). Wrapped in try/catch so a disabled localStorage just
 * yields the default rather than throwing on mount. */
function loadGroupByType(): boolean {
  try {
    return localStorage.getItem(LS_KEY_GROUP) === 'on'
  } catch {
    return false
  }
}

function normaliseHotkey(key: string): string {
  // Function keys keep their case ("F1"); printable keys collapse to lower.
  if (/^F\d+$/i.test(key)) return key.toUpperCase()
  return key.length === 1 ? key.toLowerCase() : key
}

export function CartWallProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<CartSlot[]>(loadSlots)
  const [flashing, setFlashing] = useState<Set<string>>(() => new Set())
  const [ready, setReady] = useState<Set<string>>(() => new Set())
  const [groupByType, setGroupByTypeState] = useState<boolean>(loadGroupByType)

  // Lazy AudioContext + output GainNode + MediaStream tap. Built on first
  // fire so an idle cartwall doesn't hold an autoplay-blocked context open.
  const ctxRef = useRef<AudioContext | null>(null)
  const outputRef = useRef<GainNode | null>(null)
  const streamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null)

  // Decoded audio buffers, keyed by slot id. Cleared when the slot is cleared.
  const buffersRef = useRef<Map<string, AudioBuffer>>(new Map())
  // Active sources per slot — so we could later add a "stop all" without
  // chasing them, and so multiple fires on the same slot can overlap freely.
  const sourcesRef = useRef<Map<string, Set<AudioBufferSourceNode>>>(new Map())
  // Slot snapshot for the keyboard listener — avoids stale-closure bugs while
  // letting the listener stay attached to window for the provider's lifetime.
  const slotsRef = useRef(slots)
  slotsRef.current = slots

  // Persist on every change. Cheap — JSON of 16 small objects.
  useEffect(() => { saveSlots(slots) }, [slots])

  // Persist the grouping toggle. Same write-on-change pattern as the slots
  // themselves so the choice survives reloads without explicit save calls.
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_GROUP, groupByType ? 'on' : 'off') }
    catch { /* quota / disabled — non-fatal */ }
  }, [groupByType])

  const setGroupByType = useCallback((on: boolean) => {
    setGroupByTypeState(on)
  }, [])

  const ensureContext = useCallback((): AudioContext => {
    let ctx = ctxRef.current
    if (!ctx) {
      ctx = new AudioContext()
      ctxRef.current = ctx
      const out = ctx.createGain()
      out.gain.value = 1
      outputRef.current = out
      const dest = ctx.createMediaStreamDestination()
      streamDestRef.current = dest
      // Output node feeds the cross-context bridge (MediaStream). We do NOT
      // route to ctx.destination by default — letting the speakers monitor
      // the cart wall locally is the broadcast wiring code's call, since on
      // an actual radio rig the operator hears the program return, not the
      // raw cart bus.
      out.connect(dest)
    }
    // Always nudge it — Chromium blocks contexts created before a gesture.
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => { /* will retry on next fire */ })
    }
    return ctx
  }, [])

  const decodeIntoSlot = useCallback(async (id: string, file: File) => {
    const ctx = ensureContext()
    const arr = await file.arrayBuffer()
    // decodeAudioData mutates ownership of the buffer in some implementations,
    // so we hand it a copy. Cheap for typical sting sizes (<5 MB).
    const buf = await ctx.decodeAudioData(arr.slice(0))
    buffersRef.current.set(id, buf)
    setReady(prev => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [ensureContext])

  const assign = useCallback(async (id: string, file: File) => {
    try {
      await decodeIntoSlot(id, file)
      setSlots(prev => prev.map(s => s.id === id ? {
        ...s,
        filePath: file.name,
        // Auto-name an empty/default-labelled slot from the filename so the
        // operator doesn't have to type. Strip extension + replace separators.
        label: s.label && s.label !== `Cart ${prev.findIndex(p => p.id === id) + 1}`
          ? s.label
          : file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
      } : s))
    } catch (e) {
      console.error('[cartwall] decode failed:', e)
    }
  }, [decodeIntoSlot])

  const fire = useCallback((id: string) => {
    const buf = buffersRef.current.get(id)
    if (!buf) return
    const ctx = ensureContext()
    const out = outputRef.current
    if (!out) return
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(out)
    let bucket = sourcesRef.current.get(id)
    if (!bucket) { bucket = new Set(); sourcesRef.current.set(id, bucket) }
    bucket.add(src)
    src.onended = () => { bucket?.delete(src) }
    try { src.start() } catch (e) { console.error('[cartwall] start failed:', e); return }

    // Flash indicator for 250ms — matches the prompt's spec.
    setFlashing(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    window.setTimeout(() => {
      setFlashing(prev => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, 250)
  }, [ensureContext])

  // Find a slot whose label matches `name`. Used by the Myriad bridge for
  // `cart-fire` routing — Myriad's cart-wall macro fires by item name, we
  // match it against the operator's slot labels (case-insensitive, falls
  // back to substring containment).
  const fireByName = useCallback((name: string): boolean => {
    const target = name.trim().toLowerCase()
    if (!target) return false
    const exact = slots.find(s => s.label.trim().toLowerCase() === target)
    const partial = exact ?? slots.find(s => {
      const lbl = s.label.trim().toLowerCase()
      return lbl && (lbl.includes(target) || target.includes(lbl))
    })
    if (!partial) return false
    if (!buffersRef.current.has(partial.id)) return false
    fire(partial.id)
    return true
  }, [slots, fire])

  const clear = useCallback((id: string) => {
    // Stop any in-flight playback of this slot, drop the buffer + ready flag,
    // and reset the persisted source hint. Label/hotkey/colour stay so the
    // operator's layout survives a swap.
    const bucket = sourcesRef.current.get(id)
    if (bucket) {
      bucket.forEach(s => { try { s.stop() } catch { /* ignore */ } })
      bucket.clear()
    }
    buffersRef.current.delete(id)
    setReady(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setSlots(prev => prev.map(s => s.id === id ? { ...s, filePath: null } : s))
  }, [])

  const setLabel = useCallback((id: string, label: string) => {
    setSlots(prev => prev.map(s => s.id === id ? { ...s, label } : s))
  }, [])

  const setHotkey = useCallback((id: string, key: string | null) => {
    const next = key && key.length > 0 ? normaliseHotkey(key) : null
    // If another slot already owns this hotkey, steal it — two slots on the
    // same key is just confusing.
    setSlots(prev => prev.map(s => {
      if (s.id === id) return { ...s, hotkey: next }
      if (next && s.hotkey && normaliseHotkey(s.hotkey) === next) return { ...s, hotkey: null }
      return s
    }))
  }, [])

  const setColor = useCallback((id: string, color: string) => {
    setSlots(prev => prev.map(s => s.id === id ? { ...s, color } : s))
  }, [])

  const setType = useCallback((id: string, type: MyriadItemType) => {
    setSlots(prev => prev.map(s => s.id === id ? { ...s, type } : s))
  }, [])

  // Global keyboard handler. Skips when typing into form fields, otherwise
  // matches the pressed key against any slot hotkey (case-insensitive for
  // printables, exact for F-keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      const el = document.activeElement as HTMLElement | null
      if (el) {
        const tag = el.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return
      }
      // Don't fire on modifier-laden combos — those belong to the rest of
      // the app's shortcut layer (Cmd/Ctrl/Alt/Meta).
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const pressed = normaliseHotkey(e.key)
      const hit = slotsRef.current.find(s => s.hotkey && normaliseHotkey(s.hotkey) === pressed)
      if (!hit) return
      // Only fire loaded slots. Empty slots with a bound hotkey shouldn't
      // swallow the key from the rest of the app.
      if (!buffersRef.current.has(hit.id)) return
      e.preventDefault()
      fire(hit.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fire])

  // Clean shutdown — stop sources and close the context. Persisted slots stay
  // in localStorage so the layout survives.
  useEffect(() => () => {
    sourcesRef.current.forEach(bucket => bucket.forEach(s => { try { s.stop() } catch { /* ignore */ } }))
    sourcesRef.current.clear()
    buffersRef.current.clear()
    try { ctxRef.current?.close() } catch { /* ignore */ }
    ctxRef.current = null
    outputRef.current = null
    streamDestRef.current = null
  }, [])

  const getOutputNode = useCallback((): AudioNode | null => outputRef.current, [])
  const getOutputStream = useCallback((): MediaStream | null => streamDestRef.current?.stream ?? null, [])
  const getAudioContext = useCallback((): AudioContext | null => ctxRef.current, [])

  const value = useMemo<CartWallCtx>(() => ({
    slots, flashing, ready,
    fire, fireByName, assign, clear,
    setLabel, setHotkey, setColor, setType,
    groupByType, setGroupByType,
    getOutputNode, getOutputStream, getAudioContext,
  }), [
    slots, flashing, ready,
    fire, fireByName, assign, clear,
    setLabel, setHotkey, setColor, setType,
    groupByType, setGroupByType,
    getOutputNode, getOutputStream, getAudioContext,
  ])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCartwall() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCartwall must be used inside CartWallProvider')
  return ctx
}
