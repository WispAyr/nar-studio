/**
 * NAR schedule poller — hits siphon.wispayr.online/api/nar/schedule
 * and /api/nar/current every 60s, pushes updates to renderer.
 */
import axios from 'axios'
import { getMainWindow } from './index'

const SIPHON_BASE = 'https://siphon.wispayr.online'
const POLL_INTERVAL_MS = 60_000

export interface NarShow {
  uid: string
  name: string
  description: string
  broadcaststart: string   // ISO 8601
  broadcastend: string
  thumbnail: string
  tags: Array<{ name: string; slug: string }>
}

export interface NarCurrent {
  uid: string
  name: string
  broadcaststart: string
  broadcastend: string
  thumbnail: string
  stream_url: string
}

export interface NarScheduleState {
  shows: NarShow[]
  current: NarCurrent | null
  next: NarShow | null
  fetchedAt: string
  stale: boolean
}

export class SchedulePoller {
  private timer: ReturnType<typeof setInterval> | null = null
  private state: NarScheduleState = {
    shows: [],
    current: null,
    next: null,
    fetchedAt: '',
    stale: false,
  }

  start() {
    this.poll()
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS)
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  getState(): NarScheduleState {
    return { ...this.state }
  }

  private async poll() {
    try {
      const [schedRes, curRes] = await Promise.allSettled([
        axios.get<{ data: { shows?: NarShow[] } | NarShow[]; stale: boolean; fetched_at: string }>(
          `${SIPHON_BASE}/api/nar/schedule`,
          { timeout: 10_000 }
        ),
        axios.get<{ data: NarCurrent; stale: boolean }>(
          `${SIPHON_BASE}/api/nar/current`,
          { timeout: 10_000 }
        ),
      ])

      const now = new Date()
      let shows: NarShow[] = []
      let stale = false
      let fetchedAt = now.toISOString()

      if (schedRes.status === 'fulfilled') {
        const body = schedRes.value.data
        const raw = Array.isArray(body.data) ? body.data : (body.data as any)?.shows ?? []
        shows = (raw as NarShow[]).sort(
          (a, b) => new Date(a.broadcaststart).getTime() - new Date(b.broadcaststart).getTime()
        )
        stale = body.stale
        fetchedAt = body.fetched_at ?? fetchedAt
      }

      let current: NarCurrent | null = null
      if (curRes.status === 'fulfilled') {
        current = curRes.value.data.data ?? null
      }

      // Derive "next" from schedule
      const next = shows.find(s => new Date(s.broadcaststart) > now) ?? null

      this.state = { shows, current, next, fetchedAt, stale }
      this.emit('schedule:updated', this.state)
    } catch (e) {
      console.error('[schedule] poll failed:', e)
    }
  }

  /** Find the show that should be recording now (for auto-record). */
  getCurrentShow(): NarShow | null {
    const now = new Date()
    return this.state.shows.find(s => {
      const start = new Date(s.broadcaststart)
      const end = new Date(s.broadcastend)
      return now >= start && now < end
    }) ?? null
  }

  /** Slug-safe show identifier for folder naming. */
  static showSlug(show: NarShow): string {
    return show.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) + '-' + show.uid
  }

  private emit(channel: string, data: unknown) {
    const win = getMainWindow()
    if (win) win.webContents.send(channel, data)
  }
}

export const schedulePoller = new SchedulePoller()
