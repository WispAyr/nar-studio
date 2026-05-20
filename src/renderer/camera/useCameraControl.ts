import { useCallback, useEffect, useRef, useState } from 'react'
import { useCameraStreams } from './CameraStreamProvider'

/**
 * Camera control over UVC. The OBSBot Tiny 2 Lite exposes pan/tilt/zoom and
 * image controls as standard UVC capabilities, so they are driven through the
 * video track's applyConstraints() — no native/HID code needed.
 *
 * Per-camera settings (invert, speed, image modes, presets) persist to
 * localStorage and the image settings are re-applied whenever the camera
 * reconnects, so a studio setup survives across sessions.
 */

export interface Range { min: number; max: number; step: number }
export type Axis = 'pan' | 'tilt' | 'zoom'
export type Mode = 'auto' | 'manual'

export interface CamCaps {
  pan?: Range
  tilt?: Range
  zoom?: Range
  colorTemperature?: Range
  whiteBalanceMode?: string[]
  exposureMode?: string[]
  focusMode?: string[]
}

export interface Preset { pan: number; tilt: number; zoom: number }

export const PRESET_COUNT = 6
const MOVE_INTERVAL_MS = 120

interface CamSettings {
  invertPan: boolean
  speed: number
  exposureMode: Mode
  whiteBalanceMode: Mode
  kelvin: number
  focusMode: Mode
  presets: (Preset | null)[]
}

const DEFAULT_SETTINGS: CamSettings = {
  invertPan: false,
  speed: 60,
  exposureMode: 'auto',
  whiteBalanceMode: 'auto',
  kelvin: 5600,
  focusMode: 'auto',
  presets: Array(PRESET_COUNT).fill(null),
}

const clamp = (v: number, r?: Range) => (r ? Math.min(r.max, Math.max(r.min, v)) : v)

function loadSettings(index: number): CamSettings {
  try {
    const raw = localStorage.getItem(`nar-cam${index}`)
    if (raw) {
      const parsed = JSON.parse(raw)
      const presets = Array.isArray(parsed.presets)
        ? parsed.presets.slice(0, PRESET_COUNT)
        : Array(PRESET_COUNT).fill(null)
      return { ...DEFAULT_SETTINGS, ...parsed, presets }
    }
  } catch {}
  return { ...DEFAULT_SETTINGS, presets: Array(PRESET_COUNT).fill(null) }
}

export function useCameraControl(index: number) {
  const { streams } = useCameraStreams()
  const track = streams[index]?.getVideoTracks()[0] ?? null

  const [caps, setCaps] = useState<CamCaps>({})
  const [ptz, setPtz] = useState({ pan: 0, tilt: 0, zoom: 0 })
  const ptzRef = useRef(ptz)
  ptzRef.current = ptz

  const [settings, setSettings] = useState<CamSettings>(() => loadSettings(index))
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const moveTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setSettings(loadSettings(index))
  }, [index])

  const update = useCallback((patch: Partial<CamSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      localStorage.setItem(`nar-cam${index}`, JSON.stringify(next))
      return next
    })
  }, [index])

  const applyAdv = useCallback(async (adv: Record<string, number | string>) => {
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [adv] as MediaTrackConstraintSet[] })
    } catch (e) {
      console.warn('[ptz] applyConstraints failed:', (e as Error).message)
    }
  }, [track])

  // Read capabilities + current PTZ when the camera track changes.
  useEffect(() => {
    if (!track) { setCaps({}); return }
    const c = (track.getCapabilities?.() ?? {}) as any
    setCaps({
      pan: c.pan, tilt: c.tilt, zoom: c.zoom,
      colorTemperature: c.colorTemperature,
      whiteBalanceMode: c.whiteBalanceMode,
      exposureMode: c.exposureMode,
      focusMode: c.focusMode,
    })
    const s = (track.getSettings?.() ?? {}) as any
    setPtz({ pan: s.pan ?? 0, tilt: s.tilt ?? 0, zoom: s.zoom ?? c.zoom?.min ?? 0 })
  }, [track])

  // Re-apply the saved image settings whenever the camera connects.
  useEffect(() => {
    if (!track) return
    const s = loadSettings(index)
    const adv: Record<string, number | string> = {
      exposureMode: s.exposureMode === 'auto' ? 'continuous' : 'manual',
      whiteBalanceMode: s.whiteBalanceMode === 'auto' ? 'continuous' : 'manual',
      focusMode: s.focusMode === 'auto' ? 'continuous' : 'manual',
    }
    if (s.whiteBalanceMode === 'manual') adv.colorTemperature = s.kelvin
    track.applyConstraints({ advanced: [adv] as MediaTrackConstraintSet[] }).catch(() => {})
  }, [track, index])

  const stopMove = useCallback(() => {
    if (moveTimer.current) {
      clearInterval(moveTimer.current)
      moveTimer.current = null
    }
  }, [])

  /** Begin continuous motion on an axis while a control is held. */
  const startMove = useCallback((axis: Axis, dir: 1 | -1) => {
    const range = (track && (caps[axis] as Range | undefined)) || undefined
    if (!range) return
    stopMove()
    const span = range.max - range.min
    const perTick = Math.max(range.step, Math.round((span / 40) * (settingsRef.current.speed / 100)))
    const tick = () => {
      const cur = ptzRef.current[axis]
      const dirSign = axis === 'pan' && settingsRef.current.invertPan ? -dir : dir
      const next = clamp(cur + perTick * dirSign, range)
      if (next === cur) { stopMove(); return }
      setPtz(p => ({ ...p, [axis]: next }))
      applyAdv({ [axis]: next })
    }
    tick()
    moveTimer.current = setInterval(tick, MOVE_INTERVAL_MS)
  }, [track, caps, applyAdv, stopMove])

  useEffect(() => () => stopMove(), [stopMove])

  const goHome = useCallback(() => {
    const zoom = caps.zoom?.min ?? 0
    setPtz({ pan: 0, tilt: 0, zoom })
    applyAdv({ pan: 0, tilt: 0, zoom })
  }, [caps, applyAdv])

  const setZoom = useCallback((zoom: number) => {
    const z = clamp(zoom, caps.zoom)
    setPtz(p => ({ ...p, zoom: z }))
    applyAdv({ zoom: z })
  }, [caps, applyAdv])

  const savePreset = useCallback((slot: number) => {
    if (!track) return
    const s = (track.getSettings?.() ?? {}) as any
    const cur = ptzRef.current
    const preset: Preset = {
      pan: s.pan ?? cur.pan,
      tilt: s.tilt ?? cur.tilt,
      zoom: s.zoom ?? cur.zoom,
    }
    const presets = [...settingsRef.current.presets]
    presets[slot] = preset
    update({ presets })
  }, [track, update])

  const recallPreset = useCallback((slot: number) => {
    const p = settingsRef.current.presets[slot]
    if (!p) return
    setPtz({ pan: p.pan, tilt: p.tilt, zoom: p.zoom })
    applyAdv({ pan: p.pan, tilt: p.tilt, zoom: p.zoom })
  }, [applyAdv])

  const setSpeed = useCallback((speed: number) => update({ speed }), [update])
  const setInvertPan = useCallback((invertPan: boolean) => update({ invertPan }), [update])

  const setExposure = useCallback((mode: Mode) => {
    update({ exposureMode: mode })
    applyAdv({ exposureMode: mode === 'auto' ? 'continuous' : 'manual' })
  }, [update, applyAdv])

  const setWhiteBalance = useCallback((mode: Mode, kelvin?: number) => {
    const k = kelvin ?? settingsRef.current.kelvin
    update({ whiteBalanceMode: mode, kelvin: k })
    if (mode === 'auto') applyAdv({ whiteBalanceMode: 'continuous' })
    else applyAdv({ whiteBalanceMode: 'manual', colorTemperature: k })
  }, [update, applyAdv])

  const setFocus = useCallback((mode: Mode) => {
    update({ focusMode: mode })
    applyAdv({ focusMode: mode === 'auto' ? 'continuous' : 'manual' })
  }, [update, applyAdv])

  return {
    available: !!track,
    caps,
    ptz,
    presets: settings.presets,
    invertPan: settings.invertPan,
    speed: settings.speed,
    exposureMode: settings.exposureMode,
    whiteBalanceMode: settings.whiteBalanceMode,
    kelvin: settings.kelvin,
    focusMode: settings.focusMode,
    startMove,
    stopMove,
    goHome,
    setZoom,
    savePreset,
    recallPreset,
    setSpeed,
    setInvertPan,
    setExposure,
    setWhiteBalance,
    setFocus,
  }
}
