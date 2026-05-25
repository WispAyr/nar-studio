import {
  useCallback, useEffect, useMemo, useRef, useState,
  type DragEvent, type MouseEvent as ReactMouseEvent,
} from 'react'
import { NAR_BRAND_COLORS, useCartwall, type CartSlot } from '../../cartwall/CartWallProvider'
import {
  MYRIAD_COLORS, MYRIAD_LABELS, type MyriadItemType,
} from '../common/itemTypeColors'

/**
 * Item types that may be assigned to a cart-wall slot. Container types
 * (`show`, `interview`, `ad-break`) are intentionally omitted — those are
 * rundown-level concepts, whereas a cart slot is always a single leaf
 * sting/spot.
 */
const CART_SLOT_TYPES: readonly MyriadItemType[] = [
  'music', 'jingle', 'sweeper', 'voice-track', 'advert',
  'sponsor', 'news', 'travel', 'weather', 'other',
] as const

/**
 * Display order for the "group by type" mode. Same vocabulary as
 * `CART_SLOT_TYPES` but ordered so the broadcast-critical categories
 * (music / jingle / sweep / V-T) sit at the top of the panel — matching
 * how operators scan a Myriad cart wall.
 */
const GROUP_ORDER: readonly MyriadItemType[] = [
  'music', 'jingle', 'sweeper', 'voice-track', 'advert',
  'sponsor', 'news', 'travel', 'weather', 'other',
] as const

/**
 * Modal cart wall — 4x4 grid of fire buttons.
 *
 * Layout choice: rendered as a centred overlay with a dim backdrop instead of
 * a docked panel. The operator typically opens it briefly to fire/edit, then
 * dismisses — keeping it modal stops it from stealing camera/CG screen real
 * estate during a live show.
 */
export function CartWallPanel({ onClose }: { onClose: () => void }) {
  const cw = useCartwall()
  const [edit, setEdit] = useState<{ id: string; x: number; y: number } | null>(null)

  // Close on Esc — but only when the editor popover isn't open (so Esc cancels
  // edit first, then closes the whole panel on a second press).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (edit) { setEdit(null); e.stopPropagation(); return }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [edit, onClose])

  const editingSlot = useMemo(
    () => edit ? cw.slots.find(s => s.id === edit.id) ?? null : null,
    [edit, cw.slots],
  )

  // Bucket the slots by their Myriad type for the grouped render. Loaded
  // slots (ones with audio) get sorted into their type bucket; empty slots
  // collect into a separate trailing section so the operator can still see
  // them and click-to-assign without losing them off the bottom of the wall.
  // We pre-build this even in grid mode — it's only 16 items, the cost is
  // negligible, and it keeps the branching tidy below.
  const grouped = useMemo(() => {
    const buckets = new Map<MyriadItemType, CartSlot[]>()
    const empties: CartSlot[] = []
    for (const slot of cw.slots) {
      if (!cw.ready.has(slot.id)) { empties.push(slot); continue }
      const list = buckets.get(slot.type)
      if (list) list.push(slot)
      else buckets.set(slot.type, [slot])
    }
    const sections: { type: MyriadItemType; slots: CartSlot[] }[] = []
    for (const t of GROUP_ORDER) {
      const list = buckets.get(t)
      if (list && list.length > 0) sections.push({ type: t, slots: list })
    }
    return { sections, empties }
  }, [cw.slots, cw.ready])

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-label="Cart Wall"
    >
      <div
        className="relative w-[720px] max-w-[95vw] rounded-2xl border border-surface-600 bg-surface-900 shadow-2xl shadow-black/60"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-surface-700 px-5 py-3">
          <div className="flex items-center gap-3">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: '#e5202b', boxShadow: '0 0 12px #e5202b88' }}
            />
            <h2 className="font-semibold tracking-wide text-white">Cart Wall</h2>
            <span className="text-xs uppercase tracking-widest text-slate-500">Sting Deck</span>
          </div>
          <div className="flex items-center gap-2">
            {/* View-mode toggle. Two equal-width pills so the active state is
                obvious at a glance — the operator's eye doesn't have to chase
                a tiny checkbox during a live show. */}
            <div
              className="flex overflow-hidden rounded-md border border-surface-600"
              role="group"
              aria-label="Cart wall view mode"
            >
              <button
                type="button"
                onClick={() => cw.setGroupByType(false)}
                aria-pressed={!cw.groupByType}
                className={[
                  'px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest transition-colors',
                  !cw.groupByType
                    ? 'bg-nar-blue text-white'
                    : 'bg-surface-800 text-slate-400 hover:text-white',
                ].join(' ')}
              >
                Grid
              </button>
              <button
                type="button"
                onClick={() => cw.setGroupByType(true)}
                aria-pressed={cw.groupByType}
                className={[
                  'px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest transition-colors',
                  cw.groupByType
                    ? 'bg-nar-blue text-white'
                    : 'bg-surface-800 text-slate-400 hover:text-white',
                ].join(' ')}
              >
                Group
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-sm text-slate-400 hover:bg-surface-700 hover:text-white"
              aria-label="Close cart wall"
            >
              Close
            </button>
          </div>
        </header>

        {cw.groupByType ? (
          <div className="flex flex-col gap-4 p-5">
            {grouped.sections.map(section => (
              <CartSection
                key={section.type}
                type={section.type}
                slots={section.slots}
                ready={cw.ready}
                flashing={cw.flashing}
                onFire={id => cw.fire(id)}
                onAssign={(id, file) => cw.assign(id, file)}
                onEdit={(id, x, y) => setEdit({ id, x, y })}
              />
            ))}
            {grouped.empties.length > 0 && (
              <EmptySection
                slots={grouped.empties}
                ready={cw.ready}
                flashing={cw.flashing}
                onFire={id => cw.fire(id)}
                onAssign={(id, file) => cw.assign(id, file)}
                onEdit={(id, x, y) => setEdit({ id, x, y })}
              />
            )}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-3 p-5">
            {cw.slots.map(slot => (
              <CartButton
                key={slot.id}
                slot={slot}
                ready={cw.ready.has(slot.id)}
                flashing={cw.flashing.has(slot.id)}
                onFire={() => cw.fire(slot.id)}
                onAssign={file => cw.assign(slot.id, file)}
                onEdit={(x, y) => setEdit({ id: slot.id, x, y })}
              />
            ))}
          </div>
        )}

        <footer className="border-t border-surface-700 px-5 py-2 text-xs text-slate-500">
          Right-click a cart to edit. Drag-drop audio onto a slot to load. Hotkeys fire when no input is focused.
        </footer>

        {edit && editingSlot && (
          <SlotEditor
            slot={editingSlot}
            anchorX={edit.x}
            anchorY={edit.y}
            onClose={() => setEdit(null)}
          />
        )}
      </div>
    </div>
  )
}

interface CartSectionProps {
  type: MyriadItemType
  slots: CartSlot[]
  ready: ReadonlySet<string>
  flashing: ReadonlySet<string>
  onFire: (id: string) => void
  onAssign: (id: string, file: File) => void
  onEdit: (id: string, clientX: number, clientY: number) => void
}

/**
 * One category section in grouped mode: a coloured rule + label + count
 * header, then the type's loaded slots in the same 4-column grid the panel
 * uses everywhere else. The rule colour is `MYRIAD_COLORS[type].hex` so the
 * section header carries the same visual signature as the tiles below it —
 * an operator scanning the panel matches "orange rule" to "orange tiles"
 * without reading the label.
 */
function CartSection({ type, slots, ready, flashing, onFire, onAssign, onEdit }: CartSectionProps) {
  const style = MYRIAD_COLORS[type]
  return (
    <section aria-label={MYRIAD_LABELS[type]}>
      <div className="mb-2">
        <div
          aria-hidden
          className="h-1.5 w-full rounded-sm"
          style={{ background: style.hex, boxShadow: `0 0 10px ${style.hex}66` }}
        />
        <div className="mt-1.5 flex items-baseline justify-between">
          <span
            className="text-[11px] font-bold uppercase tracking-widest"
            style={{ color: style.hex }}
          >
            {MYRIAD_LABELS[type]}
          </span>
          <span className="text-[10px] uppercase tracking-widest text-slate-500">
            {slots.length} {slots.length === 1 ? 'cart' : 'carts'}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {slots.map(slot => (
          <CartButton
            key={slot.id}
            slot={slot}
            ready={ready.has(slot.id)}
            flashing={flashing.has(slot.id)}
            onFire={() => onFire(slot.id)}
            onAssign={file => onAssign(slot.id, file)}
            onEdit={(x, y) => onEdit(slot.id, x, y)}
          />
        ))}
      </div>
    </section>
  )
}

interface EmptySectionProps {
  slots: CartSlot[]
  ready: ReadonlySet<string>
  flashing: ReadonlySet<string>
  onFire: (id: string) => void
  onAssign: (id: string, file: File) => void
  onEdit: (id: string, clientX: number, clientY: number) => void
}

/**
 * Trailing section for slots with no audio loaded. Neutral slate styling
 * (no type colour) so it visually defers to the loaded categories above —
 * but still rendered so the operator can drag-drop or click to assign
 * without flipping back to grid mode.
 */
function EmptySection({ slots, ready, flashing, onFire, onAssign, onEdit }: EmptySectionProps) {
  return (
    <section aria-label="Empty slots">
      <div className="mb-2">
        <div aria-hidden className="h-1.5 w-full rounded-sm bg-surface-700" />
        <div className="mt-1.5 flex items-baseline justify-between">
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
            Empty
          </span>
          <span className="text-[10px] uppercase tracking-widest text-slate-600">
            {slots.length} {slots.length === 1 ? 'slot' : 'slots'}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {slots.map(slot => (
          <CartButton
            key={slot.id}
            slot={slot}
            ready={ready.has(slot.id)}
            flashing={flashing.has(slot.id)}
            onFire={() => onFire(slot.id)}
            onAssign={file => onAssign(slot.id, file)}
            onEdit={(x, y) => onEdit(slot.id, x, y)}
          />
        ))}
      </div>
    </section>
  )
}

interface CartButtonProps {
  slot: CartSlot
  ready: boolean
  flashing: boolean
  onFire: () => void
  onAssign: (file: File) => void
  onEdit: (clientX: number, clientY: number) => void
}

function CartButton({ slot, ready, flashing, onFire, onAssign, onEdit }: CartButtonProps) {
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const onDragOver = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault()
    if (e.dataTransfer.types.includes('Files')) setDrag(true)
  }
  const onDragLeave = () => setDrag(false)
  const onDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault()
    setDrag(false)
    const f = e.dataTransfer.files?.[0]
    if (f && /^audio\//.test(f.type) || (f && /\.(mp3|wav|ogg|m4a|flac)$/i.test(f.name))) onAssign(f)
  }

  const onPickFile = (e: ReactMouseEvent) => {
    e.stopPropagation()
    fileRef.current?.click()
  }

  const onContextMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    onEdit(e.clientX, e.clientY)
  }

  const onClick = () => {
    if (ready) onFire()
    else fileRef.current?.click()
  }

  const isEmpty = !ready
  // Loaded tiles take a faded tint of their Myriad type so a cart wall full of
  // mixed-purpose stings reads at a glance ("the orange row is jingles, the
  // amber row is adverts"). Empty tiles keep the neutral slate-dashed look so
  // they remain visually subordinate to loaded carts.
  const typeStyle = MYRIAD_COLORS[slot.type]
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={[
        'group relative flex h-24 select-none items-stretch overflow-hidden rounded-lg',
        'border text-left transition-all duration-150',
        isEmpty
          ? 'border-dashed border-surface-600 bg-surface-800/60 hover:border-surface-500 hover:bg-surface-800'
          : `border-surface-600 ${typeStyle.bgFaded} hover:brightness-125`,
        drag ? 'ring-2 ring-nar-blue ring-offset-2 ring-offset-surface-900' : '',
        flashing ? 'ring-2 ring-white' : '',
      ].join(' ')}
      style={flashing ? { boxShadow: `0 0 24px 4px ${slot.color}cc, inset 0 0 0 1px ${slot.color}` } : undefined}
      aria-label={`Cart ${slot.label}${ready ? '' : ' (empty)'}`}
    >
      {/* Left colour stripe — slot identity at a glance. */}
      <span
        aria-hidden
        className="w-2 shrink-0 rounded-l-md"
        style={{ background: ready ? slot.color : `${slot.color}55` }}
      />
      <div className="flex flex-1 flex-col justify-between p-2">
        <div className="min-h-0 flex-1">
          {ready ? (
            <>
              <div className="line-clamp-2 pr-14 font-bold leading-tight text-white">{slot.label}</div>
              {slot.filePath && (
                <div className="mt-1 truncate text-[10px] uppercase tracking-wider text-slate-300/70">
                  {slot.filePath}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-sm font-medium text-slate-300">{slot.label}</div>
              <div className="mt-1 text-[11px] leading-snug text-slate-500">
                {slot.filePath
                  ? `Re-load "${slot.filePath}"`
                  : 'Drop audio or click to assign'}
              </div>
            </>
          )}
        </div>

        <div className="mt-1 flex items-end justify-between gap-2">
          {isEmpty ? (
            <span
              onClick={onPickFile}
              className="rounded-sm border border-surface-600 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-slate-400 hover:border-slate-400 hover:text-white"
              role="button"
            >
              Open file
            </span>
          ) : <span aria-hidden />}
          {slot.hotkey && (
            <span className="rounded-sm bg-surface-900/70 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-widest text-slate-400">
              {slot.hotkey}
            </span>
          )}
        </div>
      </div>

      {/* Type chip — top-right corner, only on loaded slots. Solid fill of the
          Myriad type colour so it pops against the faded tile background. */}
      {ready && (
        <span
          aria-hidden
          className={[
            'pointer-events-none absolute right-1.5 top-1.5 rounded',
            'px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider',
            typeStyle.bg, typeStyle.text,
          ].join(' ')}
        >
          {MYRIAD_LABELS[slot.type]}
        </span>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) onAssign(f)
          e.currentTarget.value = ''
        }}
      />
    </button>
  )
}

interface SlotEditorProps {
  slot: CartSlot
  anchorX: number
  anchorY: number
  onClose: () => void
}

/**
 * Inline editor for a single slot. Anchored near the right-click point but
 * clamped to the viewport so it never falls off-screen.
 */
function SlotEditor({ slot, anchorX, anchorY, onClose }: SlotEditorProps) {
  const cw = useCartwall()
  const [capturingKey, setCapturingKey] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  // Click-outside to dismiss.
  useEffect(() => {
    const onDown = (e: globalThis.MouseEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) onClose()
    }
    // Defer the listener install by a tick so the right-click that opened the
    // editor doesn't immediately close it.
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  // Capture-next-key flow for the hotkey field.
  useEffect(() => {
    if (!capturingKey) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturingKey(false)
        return
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        cw.setHotkey(slot.id, null)
        setCapturingKey(false)
        return
      }
      // Ignore bare modifier presses — operator hasn't picked a key yet.
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return
      cw.setHotkey(slot.id, e.key)
      setCapturingKey(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturingKey, cw, slot.id])

  // Position: clamp to viewport with a 16px margin. The editor is ~280px wide.
  // Height grew with the type picker — 380px keeps the popover fully on-screen
  // even when anchored near the bottom edge.
  const style = useMemo<React.CSSProperties>(() => {
    const W = 280, H = 380
    const left = Math.min(Math.max(8, anchorX), window.innerWidth - W - 8)
    const top = Math.min(Math.max(8, anchorY), window.innerHeight - H - 8)
    return { left, top }
  }, [anchorX, anchorY])

  const onLabelChange = useCallback((v: string) => cw.setLabel(slot.id, v), [cw, slot.id])

  return (
    <div
      ref={ref}
      className="fixed z-[1100] w-[280px] rounded-lg border border-surface-600 bg-surface-800 p-3 shadow-2xl"
      style={style}
      onClick={e => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Edit Cart</span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-slate-500 hover:text-white"
          aria-label="Close editor"
        >
          ×
        </button>
      </div>

      <div className="mb-3">
        <span className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Type</span>
        <div className="grid grid-cols-4 gap-1">
          {CART_SLOT_TYPES.map(t => {
            const s = MYRIAD_COLORS[t]
            const selected = slot.type === t
            return (
              <button
                key={t}
                type="button"
                onClick={() => cw.setType(slot.id, t)}
                aria-pressed={selected}
                aria-label={`Set type ${MYRIAD_LABELS[t]}`}
                className={[
                  'rounded px-1 py-1 text-[9px] font-bold uppercase tracking-wider',
                  'border transition-transform',
                  selected
                    ? `${s.bg} ${s.text} border-white scale-105`
                    : `${s.bgFaded} ${s.textOnFaded} border-transparent hover:scale-105`,
                ].join(' ')}
              >
                {MYRIAD_LABELS[t]}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mb-3">
        <span className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Colour</span>
        <div className="flex flex-wrap gap-1.5">
          {NAR_BRAND_COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => cw.setColor(slot.id, c)}
              className={[
                'h-6 w-6 rounded-full border-2 transition-transform',
                slot.color === c ? 'scale-110 border-white' : 'border-transparent hover:scale-110',
              ].join(' ')}
              style={{ background: c }}
              aria-label={`Set colour ${c}`}
            />
          ))}
        </div>
      </div>

      <div className="mb-3">
        <span className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Hotkey</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCapturingKey(true)}
            className={[
              'flex-1 rounded border px-2 py-1 text-left text-sm font-mono',
              capturingKey
                ? 'border-nar-blue bg-surface-900 text-white animate-pulse'
                : 'border-surface-600 bg-surface-900 text-slate-300 hover:border-slate-400',
            ].join(' ')}
          >
            {capturingKey ? 'press a key…' : (slot.hotkey ?? 'none')}
          </button>
          {slot.hotkey && !capturingKey && (
            <button
              type="button"
              onClick={() => cw.setHotkey(slot.id, null)}
              className="rounded border border-surface-600 px-2 py-1 text-xs text-slate-400 hover:border-nar-red hover:text-nar-red"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <label className="mb-3 block">
        <span className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Label</span>
        <input
          type="text"
          value={slot.label}
          onChange={e => onLabelChange(e.target.value)}
          className="w-full rounded border border-surface-600 bg-surface-900 px-2 py-1 text-sm text-white focus:border-nar-blue focus:outline-none"
          maxLength={40}
        />
      </label>

      <button
        type="button"
        onClick={() => { cw.clear(slot.id); onClose() }}
        className="w-full rounded border border-surface-600 px-2 py-1 text-xs uppercase tracking-widest text-slate-400 hover:border-nar-red hover:text-nar-red"
      >
        Clear Audio
      </button>
    </div>
  )
}

/**
 * Launcher pill for the audio strip. Manages its own open/close state so the
 * audio panel just needs to render `<CartWallButton />` somewhere.
 *
 * If the host wants to control open state externally (e.g. from a global
 * shortcut), pass `open` + `onOpenChange` — internal state is then ignored.
 */
export function CartWallButton({
  open: openProp,
  onOpenChange,
  className,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
} = {}) {
  const [openSelf, setOpenSelf] = useState(false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : openSelf
  const setOpen = useCallback((v: boolean) => {
    if (!controlled) setOpenSelf(v)
    onOpenChange?.(v)
  }, [controlled, onOpenChange])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={[
          'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold uppercase tracking-widest transition-colors',
          open
            ? 'border-nar-red bg-nar-red/15 text-nar-red shadow-[0_0_12px_-2px_rgba(229,32,43,0.6)]'
            : 'border-surface-600 bg-surface-800 text-slate-300 hover:border-nar-red hover:text-white',
          className ?? '',
        ].join(' ')}
        aria-pressed={open}
        aria-label="Toggle cart wall"
      >
        <span aria-hidden>🎵</span>
        <span>Cart</span>
      </button>
      {open && <CartWallPanel onClose={() => setOpen(false)} />}
    </>
  )
}
