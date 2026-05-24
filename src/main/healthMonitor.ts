/**
 * System health monitor — periodic checks of the things that quietly kill a
 * live broadcast (disk filling, encoder falling behind, recorder write
 * failures, compliance disk full). Re-emits problems as structured alerts the
 * renderer can show in the status bar, and fires an Electron Notification for
 * critical conditions so the operator hears about them even with the app
 * unfocused.
 *
 * Alerts are keyed by a stable `id` per source — re-emitting with the same id
 * replaces the previous one, and emitting `{ level: 'info', message:
 * 'resolved' }` with that id cancels it. This lets the monitor flip an alert
 * back off when conditions recover (e.g. disk space frees up) without the
 * renderer having to track every transition itself.
 */
import { EventEmitter } from 'events'
import { app, Notification } from 'electron'
import { execFileSync } from 'child_process'
import fs from 'fs'
import { builtinStreamer, type StreamStats } from './builtinStreamer'
import { builtinRecorder } from './builtinRecorder'
import { complianceLogger } from './complianceLogger'

export type HealthLevel = 'info' | 'warning' | 'critical'

export interface HealthAlert {
  id: string
  level: HealthLevel
  message: string
  source: string
  timestamp: number
}

/** Free-space thresholds in bytes — under 10 GB warns, under 2 GB is critical. */
const DISK_WARN_BYTES = 10 * 1024 * 1024 * 1024
const DISK_CRITICAL_BYTES = 2 * 1024 * 1024 * 1024

/** Encoder speed thresholds — read from FFmpeg progress lines. */
const ENCODER_SPEED_WARN = 0.95
const ENCODER_SPEED_RECOVER = 0.98

class HealthMonitor extends EventEmitter {
  private intervalMs = 30_000
  private timer: NodeJS.Timeout | null = null
  /** Currently active alerts keyed by id (post-dedupe). */
  private active = new Map<string, HealthAlert>()
  /** Rolling window of the last 3 streamer stats samples. */
  private streamerStats: StreamStats[] = []
  /** Whether the encoder-speed warning is currently flagged. */
  private encoderWarning = false
  /** Bound listeners so we can detach on stop(). */
  private onStreamerStats = (s: StreamStats) => this.handleStreamerStats(s)
  private onRecorderError = (msg: string) => this.handleRecorderError(msg)

  setIntervalMs(ms: number) {
    this.intervalMs = Math.max(1000, ms | 0)
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = setInterval(() => this.runChecks(), this.intervalMs)
      if (this.timer.unref) this.timer.unref()
    }
  }

  start() {
    if (this.timer) return
    builtinStreamer.on('stats', this.onStreamerStats)
    builtinRecorder.on('error', this.onRecorderError)
    // Run a first sweep right away so the renderer doesn't sit on an empty
    // alert list for 30 s after the window opens.
    this.runChecks()
    this.timer = setInterval(() => this.runChecks(), this.intervalMs)
    if (this.timer.unref) this.timer.unref()
    console.log('[health] monitor started')
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    builtinStreamer.off('stats', this.onStreamerStats)
    builtinRecorder.off('error', this.onRecorderError)
    this.streamerStats = []
    this.encoderWarning = false
  }

  getActive(): HealthAlert[] {
    return [...this.active.values()]
  }

  dismiss(id: string): boolean {
    return this.active.delete(id)
  }

  /** Run all periodic checks. Disk + compliance space. */
  private runChecks() {
    try {
      this.checkDisk('disk-recording', 'Recording disk', app.getPath('videos'))
    } catch (e: any) {
      console.warn('[health] recording disk check failed:', e?.message ?? e)
    }
    try {
      const baseDir = complianceLogger.getStatus().baseDir
      if (baseDir) this.checkDisk('disk-compliance', 'Compliance disk', baseDir)
    } catch (e: any) {
      console.warn('[health] compliance disk check failed:', e?.message ?? e)
    }
  }

  /** Check free space at `dir` and raise/clear the alert with `id`. */
  private checkDisk(id: string, source: string, dir: string) {
    const free = freeSpaceBytes(dir)
    if (free == null) return // No usable platform API — skip silently.
    const gb = (free / 1024 / 1024 / 1024).toFixed(1)
    if (free < DISK_CRITICAL_BYTES) {
      this.emitAlert({
        id, level: 'critical', source,
        message: `${source} critical — only ${gb} GB free`,
      })
    } else if (free < DISK_WARN_BYTES) {
      this.emitAlert({
        id, level: 'warning', source,
        message: `${source} low — ${gb} GB free`,
      })
    } else if (this.active.has(id)) {
      this.resolve(id, source, `${source} recovered (${gb} GB free)`)
    }
  }

  /** Watch the last 3 streamer stats — sustained low speed warns the operator. */
  private handleStreamerStats(s: StreamStats) {
    this.streamerStats.push(s)
    if (this.streamerStats.length > 3) this.streamerStats.shift()
    if (this.streamerStats.length < 3) return
    const allBelow = this.streamerStats.every(x => x.speed > 0 && x.speed < ENCODER_SPEED_WARN)
    const recovered = this.streamerStats[this.streamerStats.length - 1].speed >= ENCODER_SPEED_RECOVER
    if (allBelow && !this.encoderWarning) {
      this.encoderWarning = true
      const speed = this.streamerStats[this.streamerStats.length - 1].speed.toFixed(2)
      this.emitAlert({
        id: 'stream-encoder-speed',
        level: 'warning',
        source: 'Stream encoder',
        message: `Encoder falling behind (speed ${speed}x) — viewers may stutter`,
      })
    } else if (recovered && this.encoderWarning) {
      this.encoderWarning = false
      this.resolve('stream-encoder-speed', 'Stream encoder', 'Encoder speed recovered')
    }
  }

  private handleRecorderError(msg: string) {
    // Each recorder error is a fresh alert — bump timestamp + id so re-emitting
    // doesn't get silently deduped if a second file also fails.
    this.emitAlert({
      id: `recording-error-${Date.now()}`,
      level: 'critical',
      source: 'Recording',
      message: msg,
    })
  }

  /** Push an alert, dedupe by id, fire Notification on critical. */
  private emitAlert(partial: Omit<HealthAlert, 'timestamp'>) {
    const existing = this.active.get(partial.id)
    // Skip the round-trip if nothing changed — same level + same message.
    if (existing && existing.level === partial.level && existing.message === partial.message) return
    const alert: HealthAlert = { ...partial, timestamp: Date.now() }
    this.active.set(alert.id, alert)
    this.emit('alert', alert)
    if (alert.level === 'critical') {
      try {
        if (Notification.isSupported()) {
          new Notification({
            title: 'NAR Studio Alert',
            body: alert.message,
            silent: false,
          }).show()
        }
      } catch (e: any) {
        console.warn('[health] notification failed:', e?.message ?? e)
      }
    }
  }

  /** Emit a resolution event (info level, "resolved" in body) and clear. */
  private resolve(id: string, source: string, message: string) {
    const resolved: HealthAlert = {
      id, level: 'info', source,
      message: `${message} (resolved)`,
      timestamp: Date.now(),
    }
    this.active.delete(id)
    this.emit('alert', resolved)
  }
}

/**
 * Cross-version free-space probe. Node 18.15+ ships `fs.statfsSync`; on
 * earlier runtimes we fall back to `wmic logicaldisk` on Windows. Returns null
 * if neither path works so the caller can skip the check gracefully.
 */
function freeSpaceBytes(dir: string): number | null {
  // Make sure the dir exists — statfs on a missing dir throws.
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
  const statfs = (fs as unknown as { statfsSync?: (p: string) => { bsize: number; bavail: number } }).statfsSync
  if (typeof statfs === 'function') {
    try {
      const s = statfs(dir)
      return s.bsize * s.bavail
    } catch (e: any) {
      console.warn('[health] statfsSync failed:', e?.message ?? e)
    }
  }
  if (process.platform === 'win32') {
    try {
      // Drive letter is the first two chars (e.g. "C:"). Bail out if no letter.
      const drive = /^[a-zA-Z]:/.exec(dir)?.[0]
      if (!drive) return null
      const out = execFileSync('wmic', [
        'logicaldisk', 'where', `Caption='${drive}'`, 'get', 'FreeSpace',
      ], { encoding: 'utf8', timeout: 5000 })
      const m = out.match(/(\d{4,})/)
      return m ? Number(m[1]) : null
    } catch (e: any) {
      console.warn('[health] wmic free-space probe failed:', e?.message ?? e)
      return null
    }
  }
  return null
}

export const healthMonitor = new HealthMonitor()
