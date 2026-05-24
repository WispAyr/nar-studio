/**
 * Multi-monitor popout windows for NAR Studio Director.
 *
 * The operator runs the control surface on monitor 1 and pops the program
 * monitor (or the full multiview) onto monitor 2 in fullscreen. Each popout
 * is a separate BrowserWindow / renderer process; we cannot hand a
 * MediaStream across processes, so each popout re-mounts the React app at
 * `#popout/<view>` and re-acquires its own camera streams. Multiple
 * consumers of the same UVC device work fine — that's the deliberate
 * trade-off.
 */
import { app, BrowserWindow, screen, type Display } from 'electron'
import path from 'path'

export type PopoutView = 'program' | 'multiview'

interface PopoutEntry {
  view: PopoutView
  displayId: number
}

const windows = new Map<PopoutView, BrowserWindow>()

/** Pick the first non-primary display, or null if only one display is connected. */
function pickSecondaryDisplay(): Display | null {
  const all = screen.getAllDisplays()
  if (all.length <= 1) return null
  const primary = screen.getPrimaryDisplay()
  const secondary = all.find(d => d.id !== primary.id)
  return secondary ?? null
}

function buildLoadTarget(view: PopoutView): { url?: string; file?: string; hash: string } {
  const hash = `popout/${view}`
  if (process.env.VITE_DEV_SERVER_URL) {
    const base = process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')
    return { url: `${base}/#${hash}`, hash }
  }
  return { file: path.join(__dirname, '../../dist/index.html'), hash }
}

export function openPopout(view: PopoutView): { ok: true; displayId: number } {
  // Re-focus an existing popout rather than spawning a duplicate.
  const existing = windows.get(view)
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    const displayId = screen.getDisplayMatching(existing.getBounds()).id
    return { ok: true, displayId }
  }

  const secondary = pickSecondaryDisplay()
  const target = secondary ?? screen.getPrimaryDisplay()

  const win = new BrowserWindow({
    x: target.bounds.x,
    y: target.bounds.y,
    width: target.bounds.width,
    height: target.bounds.height,
    frame: false,
    titleBarStyle: 'hidden',
    fullscreen: !!secondary,
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: view === 'program' ? 'NAR Studio — Program' : 'NAR Studio — Multiview',
  })

  // If we only have one display, fall back to a maximised window on it. The
  // operator can drag it to another monitor manually if one appears later.
  if (!secondary) {
    win.setBounds(target.bounds)
    win.maximize()
  }

  const load = buildLoadTarget(view)
  if (load.url) {
    win.loadURL(load.url)
  } else if (load.file) {
    win.loadFile(load.file, { hash: load.hash })
  }

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    win.show()
    if (secondary) win.setFullScreen(true)
  })

  win.on('closed', () => {
    if (windows.get(view) === win) windows.delete(view)
  })

  windows.set(view, win)
  return { ok: true, displayId: target.id }
}

export function closeAll(): void {
  for (const win of Array.from(windows.values())) {
    if (!win.isDestroyed()) win.close()
  }
  windows.clear()
}

export function list(): PopoutEntry[] {
  const out: PopoutEntry[] = []
  for (const [view, win] of windows.entries()) {
    if (win.isDestroyed()) continue
    const displayId = screen.getDisplayMatching(win.getBounds()).id
    out.push({ view, displayId })
  }
  return out
}

/** Ensure popouts don't outlive the main process — wired from main/index.ts. */
export function closeAllOnQuit(): void {
  app.on('before-quit', () => closeAll())
}

export const popoutWindows = {
  openPopout,
  closeAll,
  list,
  closeAllOnQuit,
}
