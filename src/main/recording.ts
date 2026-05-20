/**
 * Show-aware recording manager.
 * Auto-starts/stops OBS recording at NAR show boundaries.
 * Records all 4 ISO camera feeds + program to /Recordings/<date>/<show-slug>/
 */
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { obsManager } from './obs'
import { schedulePoller, SchedulePoller, type NarShow } from './schedule'
import { getMainWindow } from './index'

const CHECK_INTERVAL_MS = 30_000

export interface RecordingSession {
  showUid: string
  showName: string
  showSlug: string
  outputDir: string
  startedAt: string
  autoStarted: boolean
}

class RecordingManager {
  private checkTimer: ReturnType<typeof setInterval> | null = null
  private activeSession: RecordingSession | null = null
  private autoEnabled = true
  private baseDir: string = ''

  init() {
    this.baseDir = path.join(app.getPath('videos'), 'NAR Studio', 'Recordings')
    fs.mkdirSync(this.baseDir, { recursive: true })
    this.checkTimer = setInterval(() => this.checkSchedule(), CHECK_INTERVAL_MS)
  }

  setAutoRecord(enabled: boolean) {
    this.autoEnabled = enabled
  }

  setBaseDir(dir: string) {
    this.baseDir = dir
    fs.mkdirSync(dir, { recursive: true })
  }

  async startSession(show: NarShow, auto = false): Promise<RecordingSession> {
    if (this.activeSession) await this.stopAll()

    const date = new Date(show.broadcaststart).toISOString().slice(0, 10)
    const slug = SchedulePoller.showSlug(show)
    const outputDir = path.join(this.baseDir, date, slug)
    fs.mkdirSync(outputDir, { recursive: true })

    await obsManager.setRecordingPath(outputDir)
    await obsManager.startRecording(outputDir)

    this.activeSession = {
      showUid: show.uid,
      showName: show.name,
      showSlug: slug,
      outputDir,
      startedAt: new Date().toISOString(),
      autoStarted: auto,
    }

    this.emit('recording:session', this.activeSession)
    console.log(`[recording] started session: ${slug}`)
    return this.activeSession
  }

  async stopAll() {
    if (!this.activeSession) return
    await obsManager.stopRecording()
    const session = this.activeSession
    this.activeSession = null
    this.emit('recording:session', null)
    console.log(`[recording] stopped session: ${session.showSlug}`)
  }

  getActiveSession(): RecordingSession | null {
    return this.activeSession ? { ...this.activeSession } : null
  }

  private async checkSchedule() {
    if (!this.autoEnabled) return

    const current = schedulePoller.getCurrentShow()

    if (current && !this.activeSession) {
      // Show is live and we're not recording — start
      console.log(`[recording] auto-start for: ${current.name}`)
      await this.startSession(current, true)
      return
    }

    if (!current && this.activeSession?.autoStarted) {
      // Show ended — stop auto-started session
      console.log(`[recording] auto-stop for: ${this.activeSession.showName}`)
      await this.stopAll()
    }
  }

  private emit(channel: string, data: unknown) {
    const win = getMainWindow()
    if (win) win.webContents.send(channel, data)
  }
}

export const recordingManager = new RecordingManager()
