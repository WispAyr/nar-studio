import { useCallback, useState } from 'react'
import { useCameraStreams } from '../camera/CameraStreamProvider'
import type { Preset } from '../camera/useCameraControl'

/**
 * Global studio states — a named snapshot of every camera's pan/tilt/zoom.
 * Recalling a state moves all cameras to their saved positions at once, so a
 * whole studio look ("Wide", "Two-shot", "Guest") is one click.
 *
 * Camera positions are read from / written to the UVC video tracks directly;
 * a `nar:ptz` event is dispatched per camera so any open control panel keeps
 * its displayed position in sync.
 */

export interface StudioState {
  id: string
  name: string
  cams: (Preset | null)[]
}

const STORAGE_KEY = 'nar-global-states'
const CAM_COUNT = 4

function load(): StudioState[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch {}
  return []
}

export function useStudioStates() {
  const { streams } = useCameraStreams()
  const [states, setStates] = useState<StudioState[]>(() => load())

  const persist = useCallback((next: StudioState[]) => {
    setStates(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }, [])

  const saveState = useCallback((name: string) => {
    const cams: (Preset | null)[] = Array.from({ length: CAM_COUNT }, (_, i) => {
      const track = streams[i]?.getVideoTracks()[0]
      if (!track) return null
      const s = (track.getSettings?.() ?? {}) as any
      if (s.pan == null && s.tilt == null && s.zoom == null) return null
      return { pan: s.pan ?? 0, tilt: s.tilt ?? 0, zoom: s.zoom ?? 0 }
    })
    persist([...states, { id: `gs-${Date.now()}`, name, cams }])
  }, [streams, states, persist])

  const recallState = useCallback((id: string) => {
    const state = states.find(s => s.id === id)
    if (!state) return
    state.cams.forEach((cam, i) => {
      if (!cam) return
      const track = streams[i]?.getVideoTracks()[0]
      if (!track) return
      const adv: Record<string, number> = { pan: cam.pan, tilt: cam.tilt, zoom: cam.zoom }
      track
        .applyConstraints({ advanced: [adv] as MediaTrackConstraintSet[] })
        .catch(e => console.warn('[states] recall failed for cam', i, (e as Error).message))
      window.dispatchEvent(new CustomEvent('nar:ptz', { detail: { index: i, ...cam } }))
    })
  }, [states, streams])

  const deleteState = useCallback((id: string) => {
    persist(states.filter(s => s.id !== id))
  }, [states, persist])

  return { states, saveState, recallState, deleteState }
}
