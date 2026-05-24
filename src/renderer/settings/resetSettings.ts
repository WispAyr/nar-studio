/**
 * Factory-reset for all persisted operator preferences.
 *
 * Scrubs every `nar-*` key from localStorage (per-user UI state) and asks the
 * main process to wipe the four electron-store JSON files we control (stream
 * profiles, compliance logger, OSC bridge, Unreal launcher). After reset the
 * renderer reloads so providers pick up clean state.
 *
 * Lives in its own module so it can be invoked from the keyboard help
 * overlay, a command-palette action, or programmatically from a recovery
 * flow without dragging in any provider context.
 */

const studio = (window as any).studio

/**
 * Identifiers of the electron-store namespaces we manage in main. Asking
 * main to wipe each by name is more surgical than nuking the whole userData
 * directory (which would also delete OBS connection state, recording paths
 * and other things the operator may not want reset).
 */
const STORE_NAMES = [
  'stream-profiles',
  'compliance-logger',
  'osc-bridge',
  'unreal-launcher',
  'broadcast-compressor', // not currently a store, but reserved
] as const

/** Drop every `nar-*` key from localStorage. */
function clearLocalStorage(): number {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('nar-')) keys.push(k)
  }
  for (const k of keys) localStorage.removeItem(k)
  return keys.length
}

export interface ResetResult {
  cleared: number
  reloaded: boolean
}

/**
 * Wipe everything and (by default) reload the window. Pass `reload: false`
 * if the caller wants to handle the reload itself.
 */
export async function resetAllSettings(opts: { reload?: boolean } = {}): Promise<ResetResult> {
  const cleared = clearLocalStorage()
  // Best-effort wipe of main-side stores. We don't fail the renderer reset
  // if main can't be reached — the localStorage clear alone fixes most
  // "I broke my UI state" situations.
  try { await studio?.settingsResetStores?.(STORE_NAMES) } catch { /* ignore */ }
  const reload = opts.reload !== false
  if (reload) {
    // Wait a tick so the await above truly settles before the page goes away.
    await new Promise(r => setTimeout(r, 50))
    window.location.reload()
  }
  return { cleared, reloaded: reload }
}
