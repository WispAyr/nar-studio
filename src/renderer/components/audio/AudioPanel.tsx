import { useState, useEffect, useRef, useCallback } from 'react'

const studio = (window as any).studio

export function AudioPanel() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [levels, setLevels] = useState({ L: 0, R: 0 })
  const [peak, setPeak] = useState({ L: 0, R: 0 })
  const [muted, setMuted] = useState(false)
  const [gain, setGain] = useState(100)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserLRef = useRef<AnalyserNode | null>(null)
  const analyserRRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number>(0)
  const peakHoldRef = useRef({ L: 0, R: 0, tL: 0, tR: 0 })

  // Load audio devices
  useEffect(() => {
    const load = async () => {
      await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {})
      const all = await navigator.mediaDevices.enumerateDevices()
      const inputs = all.filter(d => d.kind === 'audioinput')
      setDevices(inputs)
      // Restore saved device
      const saved = localStorage.getItem('nar-audio-device')
      if (saved && inputs.find(d => d.deviceId === saved)) {
        setSelectedId(saved)
      } else if (inputs.length) {
        setSelectedId(inputs[0].deviceId)
      }
    }
    load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => navigator.mediaDevices.removeEventListener('devicechange', load)
  }, [])

  // Start/restart audio capture when device changes
  useEffect(() => {
    if (!selectedId) return
    startCapture(selectedId)
    return () => stopCapture()
  }, [selectedId])

  const startCapture = async (deviceId: string) => {
    stopCapture()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      })
      streamRef.current = stream

      const ctx = new AudioContext()
      ctxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const gainNode = ctx.createGain()
      gainNode.gain.value = gain / 100

      // Split to stereo analysers
      const splitter = ctx.createChannelSplitter(2)
      const aL = ctx.createAnalyser()
      const aR = ctx.createAnalyser()
      aL.fftSize = 256
      aR.fftSize = 256
      analyserLRef.current = aL
      analyserRRef.current = aR

      source.connect(gainNode)
      gainNode.connect(splitter)
      splitter.connect(aL, 0)
      splitter.connect(aR, 1)

      // Also send to OBS audio input via IPC
      studio?.setAudioDevice?.(deviceId)

      startMeterLoop()
      localStorage.setItem('nar-audio-device', deviceId)
    } catch (e) {
      console.error('[audio] capture failed:', e)
    }
  }

  const stopCapture = () => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    ctxRef.current?.close()
    streamRef.current = null
    ctxRef.current = null
    analyserLRef.current = null
    analyserRRef.current = null
    setLevels({ L: 0, R: 0 })
  }

  const startMeterLoop = () => {
    const bufL = new Float32Array(256)
    const bufR = new Float32Array(256)
    const PEAK_HOLD_MS = 2000

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick)
      const aL = analyserLRef.current
      const aR = analyserRRef.current
      if (!aL || !aR) return

      aL.getFloatTimeDomainData(bufL)
      aR.getFloatTimeDomainData(bufR)

      const rmsL = Math.sqrt(bufL.reduce((s, v) => s + v * v, 0) / bufL.length)
      const rmsR = Math.sqrt(bufR.reduce((s, v) => s + v * v, 0) / bufR.length)
      // dB, clamped to -60..0
      const dbL = Math.max(-60, 20 * Math.log10(rmsL + 1e-9))
      const dbR = Math.max(-60, 20 * Math.log10(rmsR + 1e-9))
      // normalise to 0..1 over -60..0 dB
      const normL = (dbL + 60) / 60
      const normR = (dbR + 60) / 60

      const now = Date.now()
      if (normL >= peakHoldRef.current.L) { peakHoldRef.current.L = normL; peakHoldRef.current.tL = now }
      if (normR >= peakHoldRef.current.R) { peakHoldRef.current.R = normR; peakHoldRef.current.tR = now }
      if (now - peakHoldRef.current.tL > PEAK_HOLD_MS) peakHoldRef.current.L = normL
      if (now - peakHoldRef.current.tR > PEAK_HOLD_MS) peakHoldRef.current.R = normR

      setLevels({ L: normL, R: normR })
      setPeak({ L: peakHoldRef.current.L, R: peakHoldRef.current.R })
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  const handleGainChange = (v: number) => {
    setGain(v)
    if (ctxRef.current) {
      // Find gain node and update — simpler: restart capture
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 bg-surface-900 border-b border-surface-700 shrink-0">
      {/* Label */}
      <span className="text-xs text-slate-500 uppercase tracking-wider shrink-0">Audio</span>

      {/* Device selector */}
      <select
        className="bg-surface-800 border border-surface-600 rounded px-2 py-0.5 text-xs text-slate-300 outline-none max-w-52 truncate"
        value={selectedId}
        onChange={e => setSelectedId(e.target.value)}
      >
        {devices.length === 0 && <option value="">No audio devices</option>}
        {devices.map(d => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Input ${d.deviceId.slice(0, 8)}`}
          </option>
        ))}
      </select>

      {/* VU meters — L and R */}
      <div className="flex gap-1 items-end shrink-0">
        <VUMeter level={muted ? 0 : levels.L} peak={muted ? 0 : peak.L} label="L" />
        <VUMeter level={muted ? 0 : levels.R} peak={muted ? 0 : peak.R} label="R" />
      </div>

      {/* dB label */}
      <span className="text-xs font-mono text-slate-600 w-12 tabular-nums shrink-0">
        {levels.L > 0 ? `${(20 * Math.log10(levels.L + 1e-9)).toFixed(1)} dB` : '—'}
      </span>

      {/* Gain */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-xs text-slate-600">Gain</span>
        <input
          type="range" min={0} max={150} value={gain}
          onChange={e => handleGainChange(Number(e.target.value))}
          className="w-20 accent-nar-blue"
        />
        <span className="text-xs text-slate-400 tabular-nums w-8">{gain}%</span>
      </div>

      {/* Mute */}
      <button
        onClick={() => setMuted(m => !m)}
        className={`text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wider transition-colors shrink-0 ${
          muted ? 'bg-nar-red text-white' : 'bg-surface-700 text-slate-500 hover:text-slate-300'
        }`}
      >
        {muted ? 'MUTED' : 'MUTE'}
      </button>

      {/* Camera mic disable notice */}
      <span className="text-xs text-slate-700 shrink-0">— cam mics disabled</span>
    </div>
  )
}

function VUMeter({ level, peak, label }: { level: number; peak: number; label: string }) {
  const SEGMENTS = 20
  const YELLOW_FROM = 14  // top ~30% = yellow
  const RED_FROM = 18     // top ~10% = red

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex gap-px">
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const seg = SEGMENTS - 1 - i  // 0 = bottom, 19 = top
          const active = level * SEGMENTS > seg
          const isPeak = Math.round(peak * SEGMENTS) === seg + 1
          const isRed = seg >= RED_FROM
          const isYellow = seg >= YELLOW_FROM && seg < RED_FROM

          let colour = 'bg-surface-700'
          if (isPeak && peak > 0) colour = isRed ? 'bg-white' : isYellow ? 'bg-white' : 'bg-white'
          else if (active) colour = isRed ? 'bg-nar-red' : isYellow ? 'bg-nar-amber' : 'bg-nar-green'

          return <div key={i} className={`w-2 h-1 rounded-sm transition-none ${colour}`} />
        })}
      </div>
      <span className="text-xs text-slate-700">{label}</span>
    </div>
  )
}
