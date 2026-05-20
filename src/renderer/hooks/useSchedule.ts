import { useState, useEffect } from 'react'

export interface NarShow {
  uid: string
  name: string
  description: string
  broadcaststart: string
  broadcastend: string
  thumbnail: string
  genres: string[]
  timezone: string
}

export interface ScheduleState {
  shows: NarShow[]
  current: NarShow | null
  next: NarShow | null
  fetchedAt: string
  stale: boolean
}

const studio = (window as any).studio

export function useSchedule() {
  const [state, setState] = useState<ScheduleState>({
    shows: [], current: null, next: null, fetchedAt: '', stale: false,
  })

  useEffect(() => {
    studio?.getSchedule?.().then((s: ScheduleState) => { if (s) setState(s) })
    const unsub = studio?.onScheduleUpdate?.((s: ScheduleState) => setState(s))
    return () => unsub?.()
  }, [])

  // Progress within the current show, 0–1
  const progress = (() => {
    if (!state.current) return 0
    const start = new Date(state.current.broadcaststart).getTime()
    const end = new Date(state.current.broadcastend).getTime()
    const now = Date.now()
    return Math.max(0, Math.min(1, (now - start) / (end - start)))
  })()

  // Countdown to the next show
  const nextIn = (() => {
    if (!state.next) return null
    const ms = new Date(state.next.broadcaststart).getTime() - Date.now()
    if (ms <= 0) return null
    const h = Math.floor(ms / 3_600_000)
    const m = Math.floor((ms % 3_600_000) / 60_000)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  })()

  return { ...state, progress, nextIn }
}
