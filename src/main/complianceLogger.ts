/**
 * Compliance audio logger — continuous "as-broadcast" recording for Ofcom
 * compliance and after-the-fact review.
 *
 * The renderer captures the station audio with a MediaRecorder and pushes
 * encoded chunks here over IPC. This module writes them to disk as a series
 * of self-contained segment files (each starts with its own WebM header so
 * any segment plays back stand-alone), and sweeps anything older than the
 * configured retention window.
 *
 * Settings persist via electron-store. Defaults: enabled = false (operator
 * must opt in), 60-minute segments, 42-day retention (six weeks — covers
 * Ofcom's 42-day retention requirement for radio broadcasters).
 */
import fs from 'fs'
import path from 'path'
import { app, shell } from 'electron'
import Store from 'electron-store'

interface StoreSchema {
  enabled: boolean
  retentionDays: number
  segmentMinutes: number
  baseDir: string
}

const store = new Store<StoreSchema>({
  name: 'compliance-logger',
  defaults: {
    enabled: false,
    retentionDays: 42,
    segmentMinutes: 60,
    baseDir: '',
  },
})

interface ActiveSegment {
  id: string
  filePath: string
  startedAt: string
  stream: fs.WriteStream
  bytes: number
  errored: boolean
}

export interface ComplianceStatus {
  enabled: boolean
  retentionDays: number
  segmentMinutes: number
  baseDir: string
  currentFile: string | null
  currentBytes: number
  segmentStartedAt: string | null
  totalSegments: number
  totalBytes: number
  oldestSegmentDate: string | null
  lastError: string | null
}

function pad(n: number) { return n < 10 ? `0${n}` : `${n}` }

function timestampSegment(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T`
    + `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

class ComplianceLogger {
  private active: ActiveSegment | null = null
  private sweepTimer: NodeJS.Timeout | null = null
  private lastError: string | null = null

  /** Resolve a usable base directory, lazily creating it if needed. */
  private resolveBaseDir(): string {
    let dir = store.get('baseDir')
    if (!dir) {
      dir = path.join(app.getPath('videos'), 'NAR Studio', 'Compliance')
      store.set('baseDir', dir)
    }
    try { fs.mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
    return dir
  }

  /** Per-day subfolder so a year of hourly segments isn't 8 000+ flat files. */
  private dayDir(d: Date = new Date()): string {
    const base = this.resolveBaseDir()
    const sub = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const full = path.join(base, sub)
    try { fs.mkdirSync(full, { recursive: true }) } catch { /* ignore */ }
    return full
  }

  /**
   * Open a fresh segment file. Returns the ID the renderer should use for
   * subsequent write/stop calls. Called by the renderer once per rotation.
   */
  startSegment(ext = 'webm'): { id: string; filePath: string; startedAt: string } | null {
    if (this.active) {
      // Close the previous segment first so we never overlap two writers.
      this.stopSegment(this.active.id)
    }
    const now = new Date()
    const stamp = timestampSegment(now)
    const dir = this.dayDir(now)
    const filePath = path.join(dir, `${stamp}.${ext}`)
    let stream: fs.WriteStream
    try {
      stream = fs.createWriteStream(filePath)
    } catch (e: any) {
      this.lastError = `Failed to open ${filePath}: ${e?.message ?? e}`
      console.error(`[compliance] ${this.lastError}`)
      return null
    }
    const id = `compliance-${stamp}`
    const startedAt = now.toISOString()
    const seg: ActiveSegment = { id, filePath, startedAt, stream, bytes: 0, errored: false }
    stream.on('error', err => {
      if (!seg.errored) {
        seg.errored = true
        this.lastError = `Write failed: ${err.message}`
        console.error(`[compliance] ${this.lastError}`)
      }
    })
    this.active = seg
    console.log(`[compliance] segment opened: ${filePath}`)
    return { id, filePath, startedAt }
  }

  write(id: string, chunk: ArrayBuffer): boolean {
    const seg = this.active
    if (!seg || seg.id !== id || seg.errored) return false
    const buf = Buffer.from(chunk)
    seg.bytes += buf.byteLength
    return seg.stream.write(buf)
  }

  stopSegment(id: string): string | null {
    const seg = this.active
    if (!seg || seg.id !== id) return null
    try { seg.stream.end() } catch { /* ignore */ }
    this.active = null
    console.log(`[compliance] segment closed: ${seg.filePath} (${seg.bytes} bytes)`)
    return seg.filePath
  }

  /**
   * Force-close anything still open — used on app shutdown so the final
   * segment isn't truncated.
   */
  stopAll() {
    if (this.active) this.stopSegment(this.active.id)
  }

  /** Walk the compliance tree and delete day folders older than retention. */
  sweep(): { removed: number; bytesRemoved: number } {
    const base = this.resolveBaseDir()
    const retention = store.get('retentionDays')
    if (retention <= 0) return { removed: 0, bytesRemoved: 0 }
    const cutoff = Date.now() - retention * 24 * 60 * 60 * 1000
    let removed = 0
    let bytesRemoved = 0
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(base, { withFileTypes: true }) } catch { return { removed, bytesRemoved } }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      // Day folder is YYYY-MM-DD; reject anything that doesn't parse.
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entry.name)
      if (!m) continue
      const dayTime = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      if (Number.isNaN(dayTime)) continue
      // Compare against end-of-day so we never delete today's segments early.
      if (dayTime + 24 * 60 * 60 * 1000 > cutoff) continue
      const dir = path.join(base, entry.name)
      try {
        for (const f of fs.readdirSync(dir)) {
          try {
            const st = fs.statSync(path.join(dir, f))
            bytesRemoved += st.size
          } catch { /* ignore */ }
        }
        fs.rmSync(dir, { recursive: true, force: true })
        removed += 1
        console.log(`[compliance] swept ${dir}`)
      } catch (e: any) {
        console.warn(`[compliance] sweep failed for ${dir}: ${e?.message ?? e}`)
      }
    }
    return { removed, bytesRemoved }
  }

  /** Stat every segment under the base dir for status totals. */
  private inventory(): { totalSegments: number; totalBytes: number; oldestSegmentDate: string | null } {
    const base = this.resolveBaseDir()
    let totalSegments = 0
    let totalBytes = 0
    let oldestSegmentDate: string | null = null
    let days: fs.Dirent[] = []
    try { days = fs.readdirSync(base, { withFileTypes: true }) } catch { return { totalSegments, totalBytes, oldestSegmentDate } }
    for (const day of days) {
      if (!day.isDirectory()) continue
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue
      const dir = path.join(base, day.name)
      let files: string[] = []
      try { files = fs.readdirSync(dir) } catch { continue }
      for (const f of files) {
        try {
          const st = fs.statSync(path.join(dir, f))
          if (st.isFile()) {
            totalSegments += 1
            totalBytes += st.size
          }
        } catch { /* ignore */ }
      }
      if (!oldestSegmentDate || day.name < oldestSegmentDate) oldestSegmentDate = day.name
    }
    return { totalSegments, totalBytes, oldestSegmentDate }
  }

  getStatus(): ComplianceStatus {
    const inv = this.inventory()
    return {
      enabled: store.get('enabled'),
      retentionDays: store.get('retentionDays'),
      segmentMinutes: store.get('segmentMinutes'),
      baseDir: this.resolveBaseDir(),
      currentFile: this.active?.filePath ?? null,
      currentBytes: this.active?.bytes ?? 0,
      segmentStartedAt: this.active?.startedAt ?? null,
      totalSegments: inv.totalSegments,
      totalBytes: inv.totalBytes,
      oldestSegmentDate: inv.oldestSegmentDate,
      lastError: this.lastError,
    }
  }

  setEnabled(enabled: boolean) {
    store.set('enabled', enabled)
    if (!enabled) this.stopAll()
  }

  setRetentionDays(days: number) {
    const clamped = Math.max(1, Math.min(365, Math.round(days) || 42))
    store.set('retentionDays', clamped)
  }

  setSegmentMinutes(mins: number) {
    const clamped = Math.max(5, Math.min(240, Math.round(mins) || 60))
    store.set('segmentMinutes', clamped)
  }

  openFolder(): Promise<string> {
    return shell.openPath(this.resolveBaseDir())
  }

  /** Run a sweep now and again every 6 hours while the app is running. */
  startBackgroundSweep() {
    this.sweep()
    if (this.sweepTimer) return
    this.sweepTimer = setInterval(() => this.sweep(), 6 * 60 * 60 * 1000)
    if (this.sweepTimer.unref) this.sweepTimer.unref()
  }
}

export const complianceLogger = new ComplianceLogger()
