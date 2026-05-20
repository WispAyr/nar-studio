/**
 * Built-in engine recorder — receives encoded media chunks from the renderer's
 * MediaRecorder over IPC and writes them to a single file on disk.
 *
 * Recordings are filed per NAR show: Recordings/<date>/<show-slug>/, matching
 * the OBS recording manager's layout so both engines land in the same place.
 */
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

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

class BuiltinRecorder {
  private active: (BuiltinRecording & { stream: fs.WriteStream }) | null = null
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

  start(show: RecShow | null, ext: string): BuiltinRecording {
    if (this.active) this.stop()
    const dir = this.resolveDir(show)
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filePath = path.join(dir, `program-${stamp}.${ext}`)
    const stream = fs.createWriteStream(filePath)
    this.active = { id: stamp, filePath, startedAt: new Date().toISOString(), stream }
    console.log(`[builtin-rec] started: ${filePath}`)
    return { id: this.active.id, filePath, startedAt: this.active.startedAt }
  }

  write(id: string, chunk: ArrayBuffer) {
    if (this.active?.id === id) this.active.stream.write(Buffer.from(chunk))
  }

  stop(): string | null {
    if (!this.active) return null
    const filePath = this.active.filePath
    this.active.stream.end()
    this.active = null
    console.log(`[builtin-rec] stopped: ${filePath}`)
    return filePath
  }

  getActive(): BuiltinRecording | null {
    if (!this.active) return null
    return { id: this.active.id, filePath: this.active.filePath, startedAt: this.active.startedAt }
  }
}

export const builtinRecorder = new BuiltinRecorder()
