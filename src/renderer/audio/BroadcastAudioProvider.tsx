import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode, type MutableRefObject,
} from 'react'

/**
 * Single source of truth for broadcast audio.
 *
 * Owns the device capture and runs it through the broadcast processing chain
 * (input gain → optional HPF → compressor → makeup → brickwall limiter), then
 * exposes the processed signal as a MediaStream that the FFmpeg streamer and
 * compliance logger both consume. Before this provider those two consumers
 * each opened their own raw `getUserMedia`, which meant the AudioPanel's
 * "FX ON" had no effect on what actually went on-air.
 *
 * Meters (post-limiter taps) live here too so the AudioPanel can render the
 * true broadcast output without re-running an FFT in a separate context.
 */

const LS = {
  device: 'nar-audio-device',
  gain: 'nar-audio-gain',
  muted: 'nar-audio-muted',
  comp: 'nar-broadcast-compressor',
}

/** Tunable broadcast-compressor parameters. */
export interface CompressorSettings {
  enabled: boolean
  /** High-pass rumble filter at `hpfFreq` Hz. */
  hpfEnabled: boolean
  hpfFreq: number
  /** WebAudio DynamicsCompressorNode parameters. */
  threshold: number    // dB, -100..0
  ratio: number        // 1..20
  knee: number         // dB, 0..40
  attack: number       // seconds, 0..1
  release: number      // seconds, 0..1
  makeup: number       // dB, applied as a post-compressor GainNode
  /** Brickwall limiter ceiling, dBFS. -1 is the broadcast standard. */
  ceiling: number
}

export const COMPRESSOR_PRESETS: { id: string; label: string; settings: CompressorSettings }[] = [
  {
    id: 'off',
    label: 'Off',
    settings: {
      enabled: false, hpfEnabled: false, hpfFreq: 60,
      threshold: 0, ratio: 1, knee: 0, attack: 0.003, release: 0.25, makeup: 0, ceiling: -1,
    },
  },
  {
    id: 'voice',
    label: 'Voice',
    // Quick attack to grab plosives, moderate release to keep speech natural,
    // gentle 3:1 with healthy makeup so the voice sits forward in the mix.
    settings: {
      enabled: true, hpfEnabled: true, hpfFreq: 80,
      threshold: -18, ratio: 3, knee: 6, attack: 0.003, release: 0.18, makeup: 5, ceiling: -1,
    },
  },
  {
    id: 'music',
    label: 'Music',
    // Slower attack lets transients through; lower ratio preserves dynamics.
    settings: {
      enabled: true, hpfEnabled: false, hpfFreq: 40,
      threshold: -20, ratio: 2.5, knee: 8, attack: 0.012, release: 0.22, makeup: 3, ceiling: -1,
    },
  },
  {
    id: 'loud',
    label: 'Loud',
    // Aggressive — for dance / club. Heavy ratio + big makeup pushes loudness
    // toward CD-master territory. Operator should watch the GR meter.
    settings: {
      enabled: true, hpfEnabled: true, hpfFreq: 35,
      threshold: -22, ratio: 4, knee: 4, attack: 0.005, release: 0.12, makeup: 8, ceiling: -1,
    },
  },
]

const DEFAULT_SETTINGS: CompressorSettings = COMPRESSOR_PRESETS[2].settings

function loadSettings(): CompressorSettings {
  try {
    const raw = localStorage.getItem(LS.comp)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch { return DEFAULT_SETTINGS }
}

interface BroadcastAudioCtx {
  /** Available audio input devices. */
  devices: MediaDeviceInfo[]
  selectedId: string
  setSelectedId: (id: string) => void

  /** Input trim, 0..150% as on the AudioPanel slider. */
  gain: number
  setGain: (pct: number) => void
  muted: boolean
  setMuted: (m: boolean) => void

  /** Processed broadcast audio — what the streamer/compliance should record. */
  processedStream: MediaStream | null
  /** Stereo analysers tapping the post-limiter signal (what actually goes out). */
  analyserL: MutableRefObject<AnalyserNode | null>
  analyserR: MutableRefObject<AnalyserNode | null>
  /** Compressor gain reduction in dB (negative when pulling down). */
  grRef: MutableRefObject<number>

  /** Live compressor parameters + setters. */
  settings: CompressorSettings
  setSettings: (s: CompressorSettings) => void
  applyPreset: (id: string) => void
}

const Ctx = createContext<BroadcastAudioCtx | null>(null)

export function BroadcastAudioProvider({ children }: { children: ReactNode }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedId, setSelectedIdState] = useState<string>(() => localStorage.getItem(LS.device) ?? '')
  const [gain, setGainState] = useState<number>(() => {
    const v = Number(localStorage.getItem(LS.gain))
    return Number.isFinite(v) && v >= 0 && v <= 150 ? v : 100
  })
  const [muted, setMutedState] = useState<boolean>(() => localStorage.getItem(LS.muted) === '1')
  const [settings, setSettingsState] = useState<CompressorSettings>(loadSettings)

  // The processed MediaStream — handed to streamer + compliance logger.
  const [processedStream, setProcessedStream] = useState<MediaStream | null>(null)

  // Live audio nodes — captured in refs so React state changes can poke them
  // without rebuilding the graph.
  const ctxRef = useRef<AudioContext | null>(null)
  const sourceStreamRef = useRef<MediaStream | null>(null)
  const inputGainRef = useRef<GainNode | null>(null)
  const hpfRef = useRef<BiquadFilterNode | null>(null)
  // Two gain nodes form a click-free crossfade between dry input and HPF
  // output. hpfBypass carries the dry signal (gain=1 when HPF off, 0 when on);
  // hpfWet carries the filter output (gain=1 when HPF on, 0 when off).
  const hpfBypassRef = useRef<GainNode | null>(null)
  const hpfWetRef = useRef<GainNode | null>(null)
  const compressorRef = useRef<DynamicsCompressorNode | null>(null)
  const makeupRef = useRef<GainNode | null>(null)
  const limiterRef = useRef<DynamicsCompressorNode | null>(null)
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const analyserL = useRef<AnalyserNode | null>(null)
  const analyserR = useRef<AnalyserNode | null>(null)
  const grRef = useRef(0)

  // Mirror state into refs so the rebuild closure reads current values.
  const gainRef = useRef(gain); gainRef.current = gain
  const mutedRef = useRef(muted); mutedRef.current = muted
  const settingsRef = useRef(settings); settingsRef.current = settings

  // Enumerate devices once (and on devicechange).
  useEffect(() => {
    const load = async () => {
      try { await navigator.mediaDevices.getUserMedia({ audio: true }) } catch { /* user will be reprompted */ }
      const all = await navigator.mediaDevices.enumerateDevices()
      const inputs = all.filter(d => d.kind === 'audioinput')
      setDevices(inputs)
      // Pick a sensible default if the saved device has gone away.
      setSelectedIdState(prev => {
        if (prev && inputs.find(d => d.deviceId === prev)) return prev
        return inputs[0]?.deviceId ?? ''
      })
    }
    load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => navigator.mediaDevices.removeEventListener('devicechange', load)
  }, [])

  // Build / rebuild the chain when the device changes. Settings changes only
  // need a parameter update, not a teardown — handled in a separate effect.
  useEffect(() => {
    if (!selectedId) return
    let disposed = false

    const teardown = () => {
      try { sourceStreamRef.current?.getTracks().forEach(t => t.stop()) } catch { /* ignore */ }
      try { ctxRef.current?.close() } catch { /* ignore */ }
      sourceStreamRef.current = null
      ctxRef.current = null
      inputGainRef.current = null
      hpfRef.current = null
      hpfBypassRef.current = null
      hpfWetRef.current = null
      compressorRef.current = null
      makeupRef.current = null
      limiterRef.current = null
      destRef.current = null
      analyserL.current = null
      analyserR.current = null
      setProcessedStream(null)
    }

    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: selectedId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          video: false,
        })
        if (disposed) { stream.getTracks().forEach(t => t.stop()); return }
        sourceStreamRef.current = stream

        const ctx = new AudioContext()
        ctxRef.current = ctx
        ctx.resume().catch(() => { /* resumed on first gesture */ })
        const source = ctx.createMediaStreamSource(stream)

        const inputGain = ctx.createGain()
        inputGain.gain.value = mutedRef.current ? 0 : gainRef.current / 100
        inputGainRef.current = inputGain

        const hpf = ctx.createBiquadFilter()
        hpf.type = 'highpass'
        hpf.frequency.value = settingsRef.current.hpfFreq
        hpf.Q.value = 0.707
        hpfRef.current = hpf

        // A unity passthrough used when the HPF is off — wiring stays static.
        // When HPF is enabled hpfBypass.gain = 0, hpf is connected; when off
        // hpfBypass.gain = 1 and the filter contribution sums to ~0 (we keep
        // the filter wired so toggling is glitch-free).
        const hpfBypass = ctx.createGain()
        hpfBypass.gain.value = settingsRef.current.hpfEnabled ? 0 : 1
        hpfBypassRef.current = hpfBypass

        const hpfWet = ctx.createGain()
        hpfWet.gain.value = settingsRef.current.hpfEnabled ? 1 : 0
        hpfWetRef.current = hpfWet

        const compressor = ctx.createDynamicsCompressor()
        const s = settingsRef.current
        compressor.threshold.value = s.enabled ? s.threshold : 0
        compressor.ratio.value = s.enabled ? s.ratio : 1
        compressor.knee.value = s.knee
        compressor.attack.value = s.attack
        compressor.release.value = s.release
        compressorRef.current = compressor

        const makeup = ctx.createGain()
        makeup.gain.value = s.enabled ? Math.pow(10, s.makeup / 20) : 1
        makeupRef.current = makeup

        // Brickwall limiter — fast attack, short release, hard knee.
        const limiter = ctx.createDynamicsCompressor()
        limiter.threshold.value = s.ceiling
        limiter.knee.value = 0
        limiter.ratio.value = 20
        limiter.attack.value = 0.001
        limiter.release.value = 0.05
        limiterRef.current = limiter

        // Stereo split for the meters — post-limiter so meters show true
        // broadcast output.
        const splitter = ctx.createChannelSplitter(2)
        const aL = ctx.createAnalyser(); aL.fftSize = 256
        const aR = ctx.createAnalyser(); aR.fftSize = 256
        analyserL.current = aL
        analyserR.current = aR

        // Routing:
        //   source → inputGain → [hpf → hpfWet, hpfBypass] → compressor → makeup → limiter
        //                                                                          ↘ splitter → aL/aR
        //                                                                          ↘ dest (broadcast stream)
        source.connect(inputGain)
        inputGain.connect(hpf)
        hpf.connect(hpfWet)
        inputGain.connect(hpfBypass)
        hpfWet.connect(compressor)
        hpfBypass.connect(compressor)
        compressor.connect(makeup)
        makeup.connect(limiter)
        limiter.connect(splitter)
        splitter.connect(aL, 0)
        splitter.connect(aR, 1)

        // Tap the limiter output as a MediaStream for downstream consumers.
        const dest = ctx.createMediaStreamDestination()
        limiter.connect(dest)
        destRef.current = dest

        if (disposed) { teardown(); return }
        setProcessedStream(dest.stream)
      } catch (e) {
        console.error('[broadcast-audio] capture failed:', e)
      }
    })()

    return () => { disposed = true; teardown() }
  }, [selectedId])

  // Settings → live nodes. Doesn't rebuild the graph; every parameter is
  // ramped via setTargetAtTime so toggles don't click.
  useEffect(() => {
    localStorage.setItem(LS.comp, JSON.stringify(settings))
    const ctx = ctxRef.current
    const comp = compressorRef.current
    const makeup = makeupRef.current
    const hpf = hpfRef.current
    const limiter = limiterRef.current
    const wet = hpfWetRef.current
    const bypass = hpfBypassRef.current
    if (!ctx || !comp || !makeup || !hpf || !limiter || !wet || !bypass) return
    const t = ctx.currentTime
    const ramp = (p: AudioParam, v: number, tc = 0.02) => {
      try { p.cancelScheduledValues(t); p.setTargetAtTime(v, t, tc) }
      catch { p.value = v }
    }
    // Enabled toggles drop threshold/ratio + flatten makeup. The compressor
    // stays in the chain so we never re-route — easier to keep glitch-free.
    ramp(comp.threshold, settings.enabled ? settings.threshold : 0)
    ramp(comp.ratio, settings.enabled ? settings.ratio : 1)
    ramp(comp.knee, settings.knee)
    ramp(comp.attack, settings.attack)
    ramp(comp.release, settings.release)
    ramp(makeup.gain, settings.enabled ? Math.pow(10, settings.makeup / 20) : 1, 0.03)
    ramp(hpf.frequency, settings.hpfFreq)
    ramp(limiter.threshold, settings.ceiling)
    // Crossfade HPF wet/dry instead of disconnecting — toggling stays clean.
    ramp(wet.gain, settings.hpfEnabled ? 1 : 0, 0.03)
    ramp(bypass.gain, settings.hpfEnabled ? 0 : 1, 0.03)
  }, [settings])

  // Apply live gain / mute without rebuilding.
  useEffect(() => {
    localStorage.setItem(LS.gain, String(gain))
    localStorage.setItem(LS.muted, muted ? '1' : '0')
    const node = inputGainRef.current
    const ctx = ctxRef.current
    if (!node || !ctx) return
    const target = muted ? 0 : gain / 100
    try {
      node.gain.cancelScheduledValues(ctx.currentTime)
      node.gain.setTargetAtTime(target, ctx.currentTime, 0.03)
    } catch { node.gain.value = target }
  }, [gain, muted])

  // Pump the compressor's GR readout into the ref at ~30 Hz. Meters poll the
  // ref so this avoids a re-render storm.
  useEffect(() => {
    let id = 0
    const tick = () => {
      const c = compressorRef.current
      if (c) grRef.current = c.reduction
      id = window.setTimeout(tick, 33)
    }
    tick()
    return () => clearTimeout(id)
  }, [])

  const setSelectedId = useCallback((id: string) => {
    localStorage.setItem(LS.device, id)
    setSelectedIdState(id)
  }, [])
  const setGain = useCallback((pct: number) => setGainState(Math.max(0, Math.min(150, pct))), [])
  const setMuted = useCallback((m: boolean) => setMutedState(m), [])
  const setSettings = useCallback((s: CompressorSettings) => setSettingsState(s), [])
  const applyPreset = useCallback((id: string) => {
    const preset = COMPRESSOR_PRESETS.find(p => p.id === id)
    if (preset) setSettingsState(preset.settings)
  }, [])

  return (
    <Ctx.Provider value={{
      devices, selectedId, setSelectedId,
      gain, setGain, muted, setMuted,
      processedStream, analyserL, analyserR, grRef,
      settings, setSettings, applyPreset,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useBroadcastAudio() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useBroadcastAudio must be used inside BroadcastAudioProvider')
  return ctx
}
