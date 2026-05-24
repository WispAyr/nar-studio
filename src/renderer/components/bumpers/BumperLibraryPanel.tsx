import {
  useCallback, useEffect, useMemo, useRef, useState,
  type CSSProperties, type DragEvent, type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  NAR_BRAND_COLORS, useBumperLibrary, type BumperEntry,
} from '../../bumpers/BumperLibraryProvider'

/**
 * Bumper library panel — compact tile grid sized for the right sidebar (~288px).
 *
 * Each tile is one full-screen video sting. Click fires it; right-click pops
 * an inline editor; dropping a video file onto the panel registers a new one.
 *
 * Sibling-in-spirit to `CartWallPanel` but laid out as a docked sidebar tab
 * (3-col grid) rather than a modal — bumpers are usually pre-staged before
 * the show, where the cart wall is summoned mid-show for ad-hoc stings.
 */
export function BumperLibraryPanel() {
  const lib = useBumperLibrary()
  const [edit, setEdit] = useState<{ id: string; x: number; y: number } | null>(null)
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Esc cancels the open editor first; a second press is for the host shell.
  useEffect(() => {
    if (!edit) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setEdit(null); e.stopPropagation() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [edit])

  const editingBumper = useMemo(
    () => edit ? lib.bumpers.find(b => b.id === edit.id) ?? null : null,
    [edit, lib.bumpers],
  )

  const onPanelDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setDrag(true)
  }
  const onPanelDragLeave = (e: DragEvent<HTMLDivElement>) => {
    // Avoid flicker when dragging between child tiles — only clear when the
    // cursor truly leaves the panel.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setDrag(false)
  }
  const onPanelDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDrag(false)
    const files = Array.from(e.dataTransfer.files ?? [])
    for (const f of files) {
      if (/^video\//.test(f.type) || /\.(mp4|mov|webm|mkv|m4v)$/i.test(f.name)) {
        lib.addFile(f)
      }
    }
  }

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    for (const f of files) lib.addFile(f)
    e.currentTarget.value = ''
  }

  return (
    <div
      className={[
        'relative flex h-full flex-col gap-2 rounded-lg border bg-surface-900 p-2',
        drag ? 'border-nar-blue ring-2 ring-nar-blue/60' : 'border-surface-700',
      ].join(' ')}
      onDragOver={onPanelDragOver}
      onDragLeave={onPanelDragLeave}
      onDrop={onPanelDrop}
    >
      <header className="flex items-center justify-between px-1 pt-1">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: '#e5202b', boxShadow: '0 0 8px #e5202b88' }}
          />
          <h2 className="text-sm font-semibold tracking-wide text-white">Bumpers</h2>
          <span className="text-[10px] uppercase tracking-widest text-slate-500">Video Stings</span>
        </div>
        {lib.isPlaying && (
          <button
            type="button"
            onClick={lib.stop}
            className="rounded-md border border-nar-red bg-nar-red/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-nar-red hover:bg-nar-red/25"
          >
            Stop bumper
          </button>
        )}
      </header>

      {/* Known-limitation banner. Slate-amber to match the style guide note. */}
      <div className="flex items-start gap-1.5 rounded-md border border-amber-700/40 bg-amber-900/15 px-2 py-1.5 text-[10px] leading-snug text-amber-200">
        <span aria-hidden className="mt-[1px]">⚠</span>
        <span>Bumpers reset on app restart — re-add files at the start of each session.</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {lib.bumpers.map(b => (
          <BumperTile
            key={b.id}
            bumper={b}
            onFire={() => lib.fire(b.id)}
            onEdit={(x, y) => setEdit({ id: b.id, x, y })}
          />
        ))}

        {lib.bumpers.length === 0 && (
          <div className="col-span-3 rounded-md border border-dashed border-surface-700 bg-surface-800/50 p-3 text-center text-[11px] leading-snug text-slate-500">
            No bumpers yet. Drop a video file here or use “+ Add bumper” below.
          </div>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex-1 rounded-md border border-surface-600 bg-surface-800 px-2 py-1.5 text-xs font-semibold uppercase tracking-widest text-slate-200 hover:border-nar-blue hover:text-white"
        >
          + Add bumper
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={onPickFiles}
      />

      {drag && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-nar-blue/10 text-[11px] font-semibold uppercase tracking-widest text-nar-blue">
          Drop video to add bumper
        </div>
      )}

      {edit && editingBumper && (
        <BumperEditor
          bumper={editingBumper}
          anchorX={edit.x}
          anchorY={edit.y}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  )
}

interface BumperTileProps {
  bumper: BumperEntry
  onFire: () => void
  onEdit: (clientX: number, clientY: number) => void
}

function BumperTile({ bumper, onFire, onEdit }: BumperTileProps) {
  const onContextMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    onEdit(e.clientX, e.clientY)
  }

  return (
    <button
      type="button"
      onClick={onFire}
      onContextMenu={onContextMenu}
      className={[
        'group relative flex h-16 select-none flex-col overflow-hidden rounded-md',
        'border border-surface-600 bg-surface-800 text-left transition-colors duration-150',
        'hover:border-surface-500 hover:bg-surface-700',
      ].join(' ')}
      aria-label={`Fire bumper ${bumper.label}`}
    >
      {/* Top stripe — bumper identity at a glance. */}
      <span
        aria-hidden
        className="h-1 w-full shrink-0"
        style={{ background: bumper.color }}
      />
      <div className="flex flex-1 flex-col justify-between px-1.5 py-1">
        <div className="line-clamp-2 text-[11px] font-bold leading-tight text-white">
          {bumper.label}
        </div>
        <div className="flex items-end justify-between gap-1">
          <span
            aria-hidden
            className="text-nar-blue opacity-0 transition-opacity group-hover:opacity-100"
            style={{ fontSize: 11, lineHeight: 1 }}
          >
            ▶
          </span>
          {bumper.hotkey && (
            <span className="rounded-sm bg-surface-900/80 px-1 py-[1px] font-mono text-[9px] uppercase tracking-widest text-slate-400">
              {bumper.hotkey}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

interface BumperEditorProps {
  bumper: BumperEntry
  anchorX: number
  anchorY: number
  onClose: () => void
}

/**
 * Inline editor for one bumper. Anchored near the right-click point but
 * clamped to the viewport so it never falls off-screen. Mirrors the cart
 * wall editor's UX so an operator who knows one knows the other.
 */
function BumperEditor({ bumper, anchorX, anchorY, onClose }: BumperEditorProps) {
  const lib = useBumperLibrary()
  const [capturingKey, setCapturingKey] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  // Click-outside to dismiss. Deferred a tick so the opening right-click
  // doesn't immediately close it.
  useEffect(() => {
    const onDown = (e: globalThis.MouseEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) onClose()
    }
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  // Capture-next-key flow for the hotkey input.
  useEffect(() => {
    if (!capturingKey) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setCapturingKey(false); return }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        lib.setHotkey(bumper.id, null)
        setCapturingKey(false)
        return
      }
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return
      lib.setHotkey(bumper.id, e.key)
      setCapturingKey(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturingKey, lib, bumper.id])

  // Clamp to viewport with an 8px margin. Editor is ~260px wide.
  const style = useMemo<CSSProperties>(() => {
    const W = 260, H = 240
    const left = Math.min(Math.max(8, anchorX), window.innerWidth - W - 8)
    const top = Math.min(Math.max(8, anchorY), window.innerHeight - H - 8)
    return { left, top }
  }, [anchorX, anchorY])

  const onLabelChange = useCallback((v: string) => lib.setLabel(bumper.id, v), [lib, bumper.id])

  return (
    <div
      ref={ref}
      className="fixed z-[1100] w-[260px] rounded-lg border border-surface-600 bg-surface-800 p-3 shadow-2xl"
      style={style}
      onClick={e => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Edit Bumper</span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-slate-500 hover:text-white"
          aria-label="Close editor"
        >
          ×
        </button>
      </div>

      <label className="mb-2 block">
        <span className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Label</span>
        <input
          type="text"
          value={bumper.label}
          onChange={e => onLabelChange(e.target.value)}
          className="w-full rounded border border-surface-600 bg-surface-900 px-2 py-1 text-sm text-white focus:border-nar-blue focus:outline-none"
          maxLength={40}
        />
      </label>

      <div className="mb-2">
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
            {capturingKey ? 'press a key…' : (bumper.hotkey ?? 'none')}
          </button>
          {bumper.hotkey && !capturingKey && (
            <button
              type="button"
              onClick={() => lib.setHotkey(bumper.id, null)}
              className="rounded border border-surface-600 px-2 py-1 text-xs text-slate-400 hover:border-nar-red hover:text-nar-red"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="mb-3">
        <span className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Colour</span>
        <div className="flex flex-wrap gap-1.5">
          {NAR_BRAND_COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => lib.setColor(bumper.id, c)}
              className={[
                'h-5 w-5 rounded-full border-2 transition-transform',
                bumper.color === c ? 'scale-110 border-white' : 'border-transparent hover:scale-110',
              ].join(' ')}
              style={{ background: c }}
              aria-label={`Set colour ${c}`}
            />
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => { lib.remove(bumper.id); onClose() }}
        className="w-full rounded border border-surface-600 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-400 hover:border-nar-red hover:text-nar-red"
      >
        Remove
      </button>
    </div>
  )
}
