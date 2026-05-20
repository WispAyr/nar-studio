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
  /** Presenter of the live show (from /current's subtitle2), e.g. "with Amanda Jean". */
  presenter: string | null
  fetchedAt: string
  stale: boolean
}

export class SchedulePoller {
  private timer: ReturnType<typeof setInterval> | null = null
  private state: NarScheduleState = {
    shows: [],
    current: null,
    next: null,
    presenter: null,
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
        axios.get(`${SIPHON_BASE}/api/nar/schedule`, { timeout: 10_000 }),
        axios.get(`${SIPHON_BASE}/api/nar/current`, { timeout: 10_000 }),
      ])

      const now = new Date()
      let shows: NarShow[] = []
      let stale = false
      let fetchedAt = now.toISOString()

      if (schedRes.status === 'fulfilled') {
        const body = schedRes.value.data ?? {}
        const items: NarShow[] = Array.isArray(body?.data?.items) ? body.data.items : []
        shows = items
          .slice()
          .sort((a, b) => new Date(a.broadcaststart).getTime() - new Date(b.broadcaststart).getTime())
        stale = !!body?.stale
        fetchedAt = body?.fetched_at ?? fetchedAt
      } else {
        console.error('[schedule] /schedule failed:', schedRes.reason?.message)
      }

      // The /current endpoint carries the presenter (subtitle2); the schedule
      // items do not. The live show itself is still derived from the schedule.
      let presenter: string | null = null
      if (curRes.status === 'fulfilled') {
        const cur = curRes.value.data?.data
        const p = (cur?.subtitle2 || cur?.subtitle || '').trim()
        presenter = p || null
      }

      const current = shows.find(s =>
        now >= new Date(s.broadcaststart) && now < new Date(s.broadcastend)) ?? null
      const next = shows.find(s => new Date(s.broadcaststart) > now) ?? null

      this.state = { shows, current, next, presenter, fetchedAt, stale }
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
