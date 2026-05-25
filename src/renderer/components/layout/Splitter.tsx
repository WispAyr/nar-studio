import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Generic drag-to-resize splitter.
 *
 * Sits between two flex children inside a flex-row (vertical handle) or
 * flex-col (horizontal handle) container. While dragging, the parent's
 * onSize callback receives the new pixel size of the FIRST child along
 * the relevant axis — callers decide what to do with it (typically apply
 * an inline `width` or `height` style to that child).
 *
 * Persistence is the caller's job (pass the current size in via `size`
 * and persist whatever onSize sends back to localStorage). Keeping
 * persistence out of the component means a single Splitter implementation
 * serves the sidebar width, the program/multiview split, and any future
 * panels we want to make resizable, with each axis having its own storage
 * key under the caller's control.
 *
 * Double-click resets to `defaultSize` — operator escape-hatch for when
 * they drag too aggressively.
 */
interface Props {
  /** 'v' = vertical handle (resizes horizontally — between left/right siblings).
   *  'h' = horizontal handle (resizes vertically — between top/bottom siblings). */
  axis: 'v' | 'h'
  /** Pixel size to clamp the drag between. */
  min: number
  max: number
  /** Reset target on double-click. */
  defaultSize: number
  /** Live size during drag; the caller applies it to the first sibling. */
  onSize: (px: number) => void
  /** The current size — used as the start point each drag. */
  size: number
  /** Optional className appended to the handle. */
  className?: string
}

export function Splitter({ axis, min, max, defaultSize, onSize, size, className = '' }: Props) {
  const draggingRef = useRef(false)
  const startCoordRef = useRef(0)
  const startSizeRef = useRef(0)
  const [hover, setHover] = useState(false)
  const [dragging, setDragging] = useState(false)

  const onDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    draggingRef.current = true
    setDragging(true)
    startCoordRef.current = axis === 'v' ? e.clientX : e.clientY
    startSizeRef.current = size
    // Capture the pointer so the drag continues even if the cursor leaves
    // the slim handle (it will — operators drag fast).
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }, [axis, size])

  const onMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return
    const coord = axis === 'v' ? e.clientX : e.clientY
    // Inverted for the right-sidebar use case? No — caller decides which
    // sibling is "first". For sidebar use, we treat the LEFT sibling as
    // first and the right sidebar's size is computed as
    // `container - leftSize - handleW`. The caller passes the right size
    // and we report delta back accordingly.
    // To keep this generic: positive drag delta increases the first-child
    // size. Callers that resize the SECOND child (right sidebar) negate
    // the delta themselves by flipping (max - newSize) or similar — but
    // a simpler convention is "pass `size` as the dimension you want to
    // resize and treat positive drag = grow". So:
    //
    //   Right sidebar: `size` = sidebar width; drag-LEFT grows it. We
    //   negate the delta for that case via the caller's onSize wrapper.
    //
    // To keep the component agnostic we just report `size + delta`.
    const delta = coord - startCoordRef.current
    const next = Math.max(min, Math.min(max, startSizeRef.current + delta))
    onSize(next)
  }, [axis, min, max, onSize])

  const onUp = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
  }, [])

  // Apply a body cursor while dragging so it stays consistent even when
  // the cursor leaves the handle's tiny hit area.
  useEffect(() => {
    if (!dragging) return
    const cursor = axis === 'v' ? 'col-resize' : 'row-resize'
    const prev = document.body.style.cursor
    document.body.style.cursor = cursor
    return () => { document.body.style.cursor = prev }
  }, [dragging, axis])

  // 6px handle with a subtle highlight on hover/active. Tailwind dimensions
  // depend on the axis: vertical handle is `w-1.5 h-full`, horizontal is
  // `h-1.5 w-full`.
  const dim = axis === 'v' ? 'w-1.5 h-full cursor-col-resize' : 'h-1.5 w-full cursor-row-resize'
  const tint = dragging
    ? 'bg-nar-blue'
    : hover
      ? 'bg-surface-600'
      : 'bg-transparent hover:bg-surface-800'
  return (
    <div
      role="separator"
      aria-orientation={axis === 'v' ? 'vertical' : 'horizontal'}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onDoubleClick={() => onSize(defaultSize)}
      title="Drag to resize · double-click to reset"
      className={`${dim} ${tint} shrink-0 transition-colors ${className}`}
    />
  )
}

/**
 * Helper hook that persists a numeric size to localStorage and gives
 * back a [size, setSize] tuple suitable for Splitter. Avoids re-writing
 * the same restore-from-LS / save-on-change boilerplate at every call
 * site.
 */
export function usePersistedSize(key: string, defaultPx: number, min: number, max: number): [number, (px: number) => void] {
  const [size, setSizeState] = useState<number>(() => {
    const raw = localStorage.getItem(key)
    if (raw) {
      const n = Number(raw)
      if (Number.isFinite(n) && n >= min && n <= max) return n
    }
    return defaultPx
  })
  const setSize = useCallback((px: number) => {
    setSizeState(px)
    try { localStorage.setItem(key, String(Math.round(px))) } catch { /* ignore */ }
  }, [key])
  return [size, setSize]
}
