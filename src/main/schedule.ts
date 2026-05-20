/**
 * NAR schedule poller — hits siphon.wispayr.online/api/nar/schedule every 60s.
 *
 * The schedule endpoint returns { data: { count, items: [...] } }; each item
 * carries uid/name/broadcaststart/broadcastend. The currently-live and next
 * shows are derived from those items by time, so they always have a uid.
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
  genres: string[]
  timezone: string
}

export interface NarScheduleState {
  shows: NarShow[]
  current: NarShow | null
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
      const res = await axios.get(`${SIPHON_BASE}/api/nar/schedule`, { timeout: 10_000 })
      const body = res.data ?? {}
      const items: NarShow[] = Array.isArray(body?.data?.items) ? body.data.items : []
      const shows = items
        .slice()
        .sort((a, b) => new Date(a.broadcaststart).getTime() - new Date(b.broadcaststart).getTime())

      const now = new Date()
      const current = shows.find(s =>
        now >= new Date(s.broadcaststart) && now < new Date(s.broadcastend)) ?? null
      const next = shows.find(s => new Date(s.broadcaststart) > now) ?? null

      this.state = {
        shows,
        current,
        next,
        fetchedAt: body?.fetched_at ?? now.toISOString(),
        stale: !!body?.stale,
      }
      this.emit('schedule:updated', this.state)
    } catch (e) {
      console.error('[schedule] poll failed:', (e as Error).message)
    }
  }

  /** The show that should be recording now — recomputed against the clock. */
  getCurrentShow(): NarShow | null {
    const now = new Date()
    return this.state.shows.find(s =>
      now >= new Date(s.broadcaststart) && now < new Date(s.broadcastend)) ?? null
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
