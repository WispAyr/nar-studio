import { useCallback, useEffect, useState } from 'react'

/**
 * Workspace layout mode — operator's choice between the dense two-column
 * layout (program + sidebar) and the wider three-column layout (program +
 * middle producer column + sidebar). Persisted to localStorage so the
 * operator's preference survives reloads, and applied as a class on
 * <html> (`nar-layout-three-col`) for any CSS-side adjustments that need
 * to know about the mode.
 */
export type LayoutMode = 'two-col' | 'three-col'

const KEY = 'nar-layout-mode'

export function useLayoutMode(): {
  mode: LayoutMode
  setMode: (m: LayoutMode) => void
  toggle: () => void
} {
  const [mode, setModeState] = useState<LayoutMode>(() => {
    const v = localStorage.getItem(KEY)
    return v === 'three-col' ? 'three-col' : 'two-col'
  })

  useEffect(() => {
    try { localStorage.setItem(KEY, mode) } catch { /* ignore */ }
    document.documentElement.classList.toggle('nar-layout-three-col', mode === 'three-col')
    return () => { document.documentElement.classList.remove('nar-layout-three-col') }
  }, [mode])

  const setMode = useCallback((m: LayoutMode) => setModeState(m), [])
  const toggle = useCallback(() => setModeState(m => m === 'two-col' ? 'three-col' : 'two-col'), [])
  return { mode, setMode, toggle }
}
