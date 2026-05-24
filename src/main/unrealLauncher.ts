/**
 * Manages the lifecycle of the Unreal Engine companion process so the
 * operator never has to alt-tab to the engine. Configuration (path to UE,
 * path to project, optional extra args, auto-start with NAR Studio) lives
 * in electron-store. The process is supervised: crashes are auto-restarted
 * (debounced) and exit reasons are surfaced for the UI.
 *
 * Honesty: this is process orchestration, not embedding. UE renders into
 * its own window. We hand frames back to NAR Studio through NDI / Spout /
 * a virtual webcam — see docs/unreal-engine-integration.md.
 */
import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app, shell } from 'electron'
import { EventEmitter } from 'events'
import Store from 'electron-store'

interface StoreSchema {
  /** Absolute path to UnrealEditor.exe (dev) or your packaged project's .exe. */
  unrealExe: string
  /** Absolute path to the .uproject (only used when launching UnrealEditor). */
  projectPath: string
  /** Extra command-line args appended to the launch (e.g. -game -ResX=1920). */
  extraArgs: string
  /** Whether to auto-launch UE when NAR Studio starts. */
  autoLaunch: boolean
  /** Whether to run UE windowed (false) or hidden behind NAR Studio (true). */
  background: boolean
}

const store = new Store<StoreSchema>({
  name: 'unreal-launcher',
  defaults: {
    unrealExe: '',
    projectPath: '',
    extraArgs: '-ResX=1920 -ResY=1080 -WINDOWED',
    autoLaunch: false,
    background: false,
  },
})

export type UnrealState =
  | 'idle'         // never been started
  | 'starting'    // spawn issued, waiting for process to settle
  | 'running'     // healthy
  | 'crashed'     // exited unexpectedly; awaiting restart or operator intervention
  | 'stopped'     // operator stopped it cleanly

export interface UnrealStatus {
  state: UnrealState
  pid: number | null
  exitCode: number | null
  /** Wall-clock when the current process was started, ms. */
  startedAt: number | null
  /** Most-recent crash count since NAR Studio launched. */
  crashCount: number
  unrealExe: string
  projectPath: string
  extraArgs: string
  autoLaunch: boolean
  background: boolean
  lastError: string | null
}

class UnrealLauncher extends EventEmitter {
  private proc: ChildProcess | null = null
  private state: UnrealState = 'idle'
  private exitCode: number | null = null
  private startedAt: number | null = null
  private crashCount = 0
  private lastError: string | null = null
  /** Restart backoff window — clears the crash counter after stable uptime. */
  private stableSinceTimer: NodeJS.Timeout | null = null
  /** Pending restart timer when crash-rate budget allows it. */
  private restartTimer: NodeJS.Timeout | null = null
  /** Operator asked us to stop — exits are treated as intentional. */
  private retiring = false

  /** Validate that we can actually launch. */
  private check(): { ok: boolean; error?: string } {
    const exe = store.get('unrealExe')
    if (!exe || !fs.existsSync(exe)) {
      return { ok: false, error: 'Unreal executable not set or not found' }
    }
    return { ok: true }
  }

  start(): { ok: boolean; error?: string } {
    if (this.proc) return { ok: true }
    const c = this.check()
    if (!c.ok) { this.lastError = c.error ?? 'invalid configuration'; this.state = 'idle'; this.emit('status'); return c }

    const exe = store.get('unrealExe')
    const projectPath = store.get('projectPath')
    const extra = (store.get('extraArgs') || '').split(/\s+/).filter(Boolean)
    const args: string[] = []
    // UnrealEditor.exe takes the .uproject as the first positional arg; a
    // packaged build is invoked with no project arg at all. We pick based
    // on whether the operator pointed us at a .uproject.
    if (projectPath && fs.existsSync(projectPath)) args.push(projectPath)
    args.push(...extra)

    this.retiring = false
    this.state = 'starting'
    this.startedAt = Date.now()
    this.exitCode = null
    this.lastError = null
    this.emit('status')

    let child: ChildProcess
    try {
      child = spawn(exe, args, {
        cwd: path.dirname(exe),
        detached: false,
        windowsHide: store.get('background'),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e: any) {
      this.lastError = `spawn failed: ${e?.message ?? e}`
      this.state = 'crashed'
      this.emit('status')
      return { ok: false, error: this.lastError }
    }
    this.proc = child

    child.stdout?.on('data', d => {
      // UE is *extremely* chatty — only log lines that look like a real issue
      // so we don't drown stdout. The full log lives in the UE Saved/Logs file.
      const text = d.toString()
      if (/Error|LogStreaming: Warning|Fatal/i.test(text)) {
        console.warn('[unreal]', text.trim().slice(0, 500))
      }
    })
    child.stderr?.on('data', d => {
      const text = d.toString()
      this.lastError = text.slice(-500)
    })

    // A clean settle window: if the process is still up after 3 s we call it
    // running. This avoids flipping to 'running' for a process that aborts
    // immediately on missing-plugin / corrupt-project errors.
    const settleTimer = setTimeout(() => {
      if (this.proc === child && this.state === 'starting') {
        this.state = 'running'
        this.emit('status')
      }
    }, 3000)

    // Stable-uptime watch: if we stay up for 30 s, clear the crash counter so
    // future crashes can be retried fresh. Otherwise we'd permanently bake in
    // crashes from an earlier session.
    if (this.stableSinceTimer) clearTimeout(this.stableSinceTimer)
    this.stableSinceTimer = setTimeout(() => {
      if (this.proc === child) this.crashCount = 0
    }, 30_000)

    child.on('exit', (code, signal) => {
      clearTimeout(settleTimer)
      if (this.proc === child) this.proc = null
      this.exitCode = code
      if (this.retiring) {
        this.state = 'stopped'
        this.emit('status')
        return
      }
      this.crashCount += 1
      const msg = `UE exited (code=${code}, signal=${signal ?? '—'})`
      console.error('[unreal]', msg)
      this.lastError = msg
      this.state = 'crashed'
      this.emit('status')
      // Supervisor: restart with exponential backoff, capped at 30s, but bail
      // after 5 crashes in a row so we don't loop on a broken project.
      if (this.crashCount <= 5) {
        const delay = Math.min(30_000, 2_000 * (2 ** Math.min(this.crashCount - 1, 4)))
        this.restartTimer = setTimeout(() => { if (!this.proc && !this.retiring) this.start() }, delay)
      } else {
        console.error('[unreal] crash budget exceeded — leaving operator to investigate')
      }
    })
    child.on('error', err => {
      this.lastError = `process error: ${err.message}`
      console.error('[unreal] error:', err.message)
    })
    return { ok: true }
  }

  stop() {
    this.retiring = true
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null }
    if (this.stableSinceTimer) { clearTimeout(this.stableSinceTimer); this.stableSinceTimer = null }
    const p = this.proc
    if (!p) {
      this.state = 'stopped'
      this.emit('status')
      return
    }
    // SIGTERM first, then SIGKILL after a grace period. UE handles SIGTERM
    // cleanly on most platforms; on Windows we just rely on Node's wrapper.
    try { p.kill('SIGTERM') } catch { /* ignore */ }
    setTimeout(() => { if (p === this.proc) { try { p.kill('SIGKILL') } catch { /* ignore */ } } }, 4000)
  }

  /** Called once during app startup if autoLaunch is enabled. */
  bootIfRequested() {
    if (store.get('autoLaunch')) this.start()
  }

  /** Cleanly shut down on app quit so we don't orphan a UE process. */
  shutdown() {
    if (this.proc) this.stop()
  }

  getStatus(): UnrealStatus {
    return {
      state: this.state,
      pid: this.proc?.pid ?? null,
      exitCode: this.exitCode,
      startedAt: this.startedAt,
      crashCount: this.crashCount,
      unrealExe: store.get('unrealExe'),
      projectPath: store.get('projectPath'),
      extraArgs: store.get('extraArgs'),
      autoLaunch: store.get('autoLaunch'),
      background: store.get('background'),
      lastError: this.lastError,
    }
  }

  setConfig(patch: Partial<StoreSchema>) {
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) store.set(k as keyof StoreSchema, v as any)
    }
    this.emit('status')
  }

  /** Open the configured .uproject (or UE exe) in Explorer for inspection. */
  revealProject(): string {
    const p = store.get('projectPath') || store.get('unrealExe')
    if (p) shell.showItemInFolder(p)
    return p
  }
}

export const unrealLauncher = new UnrealLauncher()

// Surface child events so the renderer can update its UI immediately rather
// than polling. Wired in main/index.ts.
export function registerUnrealLauncherEvents(send: (status: UnrealStatus) => void) {
  unrealLauncher.on('status', () => send(unrealLauncher.getStatus()))
}

// Re-export the launcher app handle for callers that need cleanup hooks.
export function bindUnrealLauncherShutdown() {
  app.on('before-quit', () => unrealLauncher.shutdown())
}
