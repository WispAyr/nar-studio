/**
 * Built-in engine recorder — receives encoded media chunks from the renderer's
 * MediaRecorders over IPC and writes them to disk.
 *
 * One session can hold several concurrent recordings: the program output plus
 * a clean ISO file per camera. They are filed together under
 * Recordings/<date>/<show-slug>/, matching the OBS recording manager's layout.
 */
import fs from 'fs'
import path from 'path'
import { app, shell } from 'electron'
import { EventEmitter } from 'events'

export interface RecShow {
  name: string
  uid: string
  broadcaststart?: string
}

export interface BuiltinRecording {
  id: string
  filePath: string
  startedAt: string
}

function showSlug(name: string, uid: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'show'
  return `${base}-${uid}`
}

interface ActiveStream extends BuiltinRecording {
  stream: fs.WriteStream
  errored: boolean
}

/** Emits 'error' (with a message) when a recording file fails to write. */
class BuiltinRecorder extends EventEmitter {
  private streams = new Map<string, ActiveStream>()
  /** Shared directory for the current recording session. */
  private sessionDir: string | null = null
  private baseDir = ''

  setBaseDir(dir: string) {
    this.baseDir = dir
  }

  private resolveDir(show: RecShow | null): string {
    if (!this.baseDir) {
      this.baseDir = path.join(app.getPath('videos'), 'NAR Studio', 'Recordings')
    }
    if (show && show.uid) {
      const date = (show.broadcaststart ? new Date(show.broadcaststart) : new Date())
        .toISOString().slice(0, 10)
      return path.join(this.baseDir, date, showSlug(show.name, show.uid))
    }
    return path.join(this.baseDir, new Date().toISOString().slice(0, 10))
  }

  /**
   * Open a new file in the current session. `name` is the filename prefix
   * ('program', 'cam1', …). The session directory is resolved on the first
   * call and shared by every file until they have all stopped.
   */
  start(show: RecShow | null, name: string, ext: string): BuiltinRecording {
    if (!this.sessionDir) {
      this.sessionDir = this.resolveDir(show)
      fs.mkdirSync(this.sessionDir, { recursive: true })
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const id = `${name}-${stamp}`
    const filePath = path.join(this.sessionDir, `${name}-${stamp}.${ext}`)
    const stream = fs.createWriteStream(filePath)
    const startedAt = new Date().toISOString()
    this.streams.set(id, { id, filePath, startedAt, stream, errored: false })
    // Surface disk-write failures (disk full, permissions) — once per file.
    stream.on('error', err => {
      const rec = this.streams.get(id)
      if (rec && !rec.errored) {
        rec.errored = true
        console.error(`[builtin-rec] write failed: ${rec.filePath}: ${err.message}`)
        this.emit('error', `Recording write failed (${name}) — ${err.message}`)
      }
    })
    console.log(`[builtin-rec] started: ${filePath}`)
    return { id, filePath, startedAt }
  }

  write(id: string, chunk: ArrayBuffer) {
    const rec = this.streams.get(id)
    if (rec && !rec.errored) rec.stream.write(Buffer.from(chunk))
  }

  stop(id: string): string | null {
    const rec = this.streams.get(id)
    if (!rec) return null
    rec.stream.end()
    this.streams.delete(id)
    // The session is over once its last file has closed.
    if (this.streams.size === 0) this.sessionDir = null
    console.log(`[builtin-rec] stopped: ${rec.filePath}`)
    return rec.filePath
  }

  /** Close every open recording — used on app shutdown. */
  stopAll() {
    for (const id of [...this.streams.keys()]) this.stop(id)
  }

  /** Open the recordings location — the live session folder, or the root. */
  openFolder(): Promise<string> {
    const dir = this.sessionDir
      ?? (this.baseDir || path.join(app.getPath('videos'), 'NAR Studio', 'Recordings'))
    try { fs.mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
    return shell.openPath(dir)
  }
}

export const builtinRecorder = new BuiltinRecorder()
