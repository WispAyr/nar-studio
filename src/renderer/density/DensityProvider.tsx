/**
 * Global UI density preference.
 *
 * Owns a single boolean (`compact`) that flips the class
 * `nar-density-compact` on `document.documentElement`. A small CSS section in
 * `src/renderer/index.css` scopes shrunken paddings, gaps and font sizes
 * under that class — so toggling here gives the operator an instant,
 * app-wide higher-density layout without rebuilding the component tree.
 *
 * Persisted to localStorage under `nar-density-compact` (values `'on'` /
 * `'off'`) so the preference survives restarts. Exposed via the sidebar's ≡
 * menu (Settings group) and the Ctrl-K command palette.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'nar-density-compact'
const CLASS_NAME = 'nar-density-compact'

interface DensityCtx {
  compact: boolean
  setCompact: (v: boolean) => void
  toggleCompact: () => void
}

const Ctx = createContext<DensityCtx | null>(null)

function readInitial(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

export function DensityProvider({ children }: { children: ReactNode }) {
  const [compact, setCompactState] = useState<boolean>(readInitial)

  // Mirror state -> <html> class + localStorage on every change. Cleanup
  // removes the class on unmount so a hot-reload of the provider tree
  // doesn't leave a stale class behind.
  useEffect(() => {
    const root = document.documentElement
    if (compact) root.classList.add(CLASS_NAME)
    else root.classList.remove(CLASS_NAME)
    try {
      localStorage.setItem(STORAGE_KEY, compact ? 'on' : 'off')
    } catch {
      /* ignore quota / disabled storage */
    }
    return () => {
      // Only strip on full unmount; transient state changes are handled by
      // the add/remove above. React calls cleanup before re-running the
      // effect, so the next run immediately re-applies the correct class.
      document.documentElement.classList.remove(CLASS_NAME)
    }
  }, [compact])

  const setCompact = useCallback((v: boolean) => setCompactState(v), [])
  const toggleCompact = useCallback(() => setCompactState(v => !v), [])

  return (
    <Ctx.Provider value={{ compact, setCompact, toggleCompact }}>
      {children}
    </Ctx.Provider>
  )
}

export function useDensity(): DensityCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDensity must be used inside <DensityProvider>')
  return ctx
}
