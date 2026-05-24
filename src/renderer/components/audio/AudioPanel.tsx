import { useState, useEffect, useRef, useCallback } from 'react'
import { useViz } from '../../viz/VizProvider'
import { useCompliance } from '../../compliance/ComplianceProvider'
import { useBroadcastAudio, COMPRESSOR_PRESETS, type CompressorSettings } from '../../audio/BroadcastAudioProvider'
import { CartWallButton } from '../cartwall/CartWallButton'

const studio = (window as any).studio

/**
 * Always-on top strip showing the broadcast audio state.
 *
 * AudioPanel is presentation only — the device capture, processing chain and
 * stream routing live in `BroadcastAudioProvider`. This component reads from
 * it for meters/sliders and renders the popovers (broadcast compressor and
 * compliance logger). When this panel goes away the broadcast keeps going.
 */
export function AudioPanel() {
  const audio = useBroadcastAudio()
  const { devices, selectedId, setSelectedId, gain, setGain, muted, setMuted, analyserL, analyserR, grRef, settings } = audio

  const [levels, setLevels] = useState({ L: 0, R: 0 })
  const [peak, setPeak] = useState({ L: 0, R: 0 })
  const [tone, setTone] = useState(false)
  const [lufs, setLufs] = useState(-60)
  const [gr, setGr] = useState(0)
  const [showCompressor, setShowCompressor] = useState(false)

  const toneRef = useRef<{ ctx: AudioContext; osc: OscillatorNode } | null>(null)
  const rafRef = useRef(0)
  const peakHoldRef = useRef({ L: 0, R: 0, tL: 0, tR: 0 })

  // 1 kHz test tone — toggleable Web Audio sine at -18 dBFS for chain checks.
  const toggleTone = useCallback(() => {
    if (toneRef.current) {
      try { toneRef.current.osc.stop() } catch { /* ignore */ }
      try { toneRef.current.ctx.close() } catch { /* ignore */ }
      toneRef.current = null
      setTone(false)
      return
    }
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.frequency.value = 1000
      osc.type = 'sine'
      g.gain.value = 0.126   // ≈ -18 dBFS
      osc.connect(g).connect(ctx.destination)
      osc.start()
      toneRef.current = { ctx, osc }
      setTone(true)
    } catch (e) {
      console.error('[audio] tone failed:', e)
    }
  }, [])

  useEffect(() => () => {
    if (toneRef.current) {
      try { toneRef.current.osc.stop() } catch { /* ignore */ }
      try { toneRef.current.ctx.close() } catch { /* ignore */ }
    }
  }, [])

  // Mirror OBS audio device when the operator changes it here.
  useEffect(() => {
    if (selectedId) studio?.setAudioDevice?.(selectedId)
  }, [selectedId])

  // Poll the viz LUFS at ~5 Hz — the value is already smoothed in VizProvider.
  const { levelsRef } = useViz()
  useEffect(() => {
    const id = window.setInterval(() => {
      const v = levelsRef.current.lufs
      setLufs(prev => Math.abs(prev - v) < 0.3 ? prev : v)
    }, 200)
    return () => window.clearInterval(id)
  }, [levelsRef])

  // Meter loop — reads the provider's analysers. Stays a single rAF, no
  // re-allocation per tick.
  useEffect(() => {
    const bufL = new Float32Array(256)
    const bufR = new Float32Array(256)
    const PEAK_HOLD_MS = 2000
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick)
      const aL = analyserL.current
      const aR = analyserR.current
      if (!aL || !aR) {
        setLevels({ L: 0, R: 0 })
        setPeak({ L: 0, R: 0 })
        return
      }
      aL.getFloatTimeDomainData(bufL)
      aR.getFloatTimeDomainData(bufR)
      const rmsL = Math.sqrt(bufL.reduce((s, v) => s + v * v, 0) / bufL.length)
      const rmsR = Math.sqrt(bufR.reduce((s, v) => s + v * v, 0) / bufR.length)
      const dbL = Math.max(-60, 20 * Math.log10(rmsL + 1e-9))
      const dbR = Math.max(-60, 20 * Math.log10(rmsR + 1e-9))
      const normL = (dbL + 60) / 60
      const normR = (dbR + 60) / 60
      const now = Date.now()
      if (normL >= peakHoldRef.current.L) { peakHoldRef.current.L = normL; peakHoldRef.current.tL = now }
      if (normR >= peakHoldRef.current.R) { peakHoldRef.current.R = normR; peakHoldRef.current.tR = now }
      if (now - peakHoldRef.current.tL > PEAK_HOLD_MS) peakHoldRef.current.L = normL
      if (now - peakHoldRef.current.tR > PEAK_HOLD_MS) peakHoldRef.current.R = normR
      setLevels({ L: normL, R: normR })
      setPeak({ L: peakHoldRef.current.L, R: peakHoldRef.current.R })
      // Compressor reduction — ref is updated by the provider; throttle.
      const v = grRef.current
      setGr(prev => Math.abs(prev - v) < 0.2 ? prev : v)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [analyserL, analyserR, grRef])

  return (
    <div className="relative flex items-center gap-3 px-4 py-1.5 bg-surface-900 border-b border-surface-700 shrink-0">
      <span className="text-xs text-slate-500 uppercase tracking-wider shrink-0">Audio</span>

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

      {/* VU meters — L and R, post-limiter so they show true broadcast output */}
      <div className="flex gap-1 items-end shrink-0">
        <VUMeter level={muted ? 0 : levels.L} peak={muted ? 0 : peak.L} label="L" />
        <VUMeter level={muted ? 0 : levels.R} peak={muted ? 0 : peak.R} label="R" />
      </div>

      <span className="text-xs font-mono text-slate-600 w-12 tabular-nums shrink-0">
        {levels.L > 0 ? `${(20 * Math.log10(levels.L + 1e-9)).toFixed(1)} dB` : '—'}
      </span>

      <span
        className={`text-xs font-mono w-16 tabular-nums shrink-0 ${
          lufs > -28 && lufs < -18 ? 'text-nar-amber' : 'text-slate-600'
        }`}
        title="Approximate momentary loudness, ITU-R BS.1770 K-weighted. Target ≈ -23 LUFS for UK broadcast."
      >
        {lufs > -59 ? `${lufs.toFixed(1)} LU` : '—'}
      </span>

      {/* Broadcast input gain */}
      <div className="flex items-center gap-1.5 shrink-0" title="Broadcast input gain — drives the stream + recorder + meters. Sits before the compressor.">
        <span className="text-xs text-slate-600 font-bold uppercase tracking-wider">Out</span>
        <input
          type="range" min={0} max={150} value={gain}
          onChange={e => setGain(Number(e.target.value))}
          className="w-20 accent-nar-blue"
        />
        <span className="text-xs text-slate-400 tabular-nums w-8">{gain}%</span>
      </div>

      {/* Viz analyser gain — separate path */}
      <VizGainSlider />

      <button
        onClick={() => setMuted(!muted)}
        className={`text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wider transition-colors shrink-0 ${
          muted ? 'bg-nar-red text-white' : 'bg-surface-700 text-slate-500 hover:text-slate-300'
        }`}
      >
        {muted ? 'MUTED' : 'MUTE'}
      </button>

      {/* Broadcast compressor — quick toggle + popover */}
      <CompressorStrip
        settings={settings}
        gr={gr}
        onToggle={() => audio.setSettings({ ...settings, enabled: !settings.enabled })}
        onOpenPanel={() => setShowCompressor(true)}
      />

      <button
        onClick={toggleTone}
        title="1 kHz sine at -18 dBFS — pair with the Slate viz mode for full broadcast alignment"
        className={`text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wider transition-colors shrink-0 ${
          tone ? 'bg-nar-amber text-white' : 'bg-surface-700 text-slate-500 hover:text-slate-300'
        }`}
      >
        {tone ? '1k ON' : '1k TONE'}
      </button>

      <ComplianceStrip />

      {/* Cart wall — soundboard of stings/jingles/IDs that mix into the
          broadcast bus pre-compressor via CartWallBroadcastBridge. */}
      <CartWallButton />

      <span className="text-xs text-slate-700 shrink-0">— cam mics disabled</span>

      {showCompressor && <CompressorPanel onClose={() => setShowCompressor(false)} />}
    </div>
  )
}

/**
 * Quick compressor status chip — FX ON/OFF toggle, gain-reduction readout,
 * ⚙ button opening the detailed control panel.
 */
function CompressorStrip({
  settings, gr, onToggle, onOpenPanel,
}: {
  settings: CompressorSettings
  gr: number
  onToggle: () => void
  onOpenPanel: () => void
}) {
  return (
    <>
      <button
        onClick={onToggle}
        title={settings.enabled
          ? `Broadcast compressor ON — ${settings.ratio.toFixed(1)}:1 @ ${settings.threshold.toFixed(0)} dB, ${settings.makeup.toFixed(1)} dB makeup. Affects the actual stream + recorder + compliance log.`
          : 'Broadcast compressor OFF — raw input goes on-air. Click to enable.'
        }
        className={`text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wider transition-colors shrink-0 ${
          settings.enabled ? 'bg-nar-blue text-white' : 'bg-surface-700 text-slate-500 hover:text-slate-300'
        }`}
      >
        {settings.enabled ? 'FX ON' : 'FX OFF'}
      </button>
      <span
        className={`text-xs font-mono w-12 tabular-nums shrink-0 ${
          settings.enabled && gr < -0.5 ? 'text-nar-amber' : 'text-slate-600'
        }`}
        title="Compressor gain reduction (dB)"
      >
        {settings.enabled && gr < -0.1 ? gr.toFixed(1) : '0.0'}
      </span>
      <button
        onClick={onOpenPanel}
        title="Open broadcast compressor settings"
        className="text-xs px-1.5 py-0.5 rounded text-slate-500 hover:text-slate-300 shrink-0"
      >
        ⚙
      </button>
    </>
  )
}

/**
 * Detailed broadcast compressor control panel — high-pass filter, presets,
 * threshold/ratio/knee/attack/release, makeup, brickwall ceiling, GR meter.
 * Sits over the AudioPanel as a popover.
 */
function CompressorPanel({ onClose }: { onClose: () => void }) {
  const { settings, setSettings, applyPreset, grRef } = useBroadcastAudio()
  const [, force] = useState(0)
  // Re-render at ~10 Hz to animate the GR meter; cheap because the panel
  // only paints while open.
  useEffect(() => {
    const id = window.setInterval(() => force(n => n + 1), 100)
    return () => window.clearInterval(id)
  }, [])

  const update = (patch: Partial<CompressorSettings>) =>
    setSettings({ ...settings, ...patch })

  const gr = Math.max(-20, Math.min(0, grRef.current))
  const grPct = Math.abs(gr) / 20 * 100

  return (
    <div
      className="absolute right-2 top-12 z-50 bg-surface-900 border border-surface-700 rounded p-4 w-96 shadow-2xl"
      onMouseLeave={onClose}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Broadcast Compressor</span>
        <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-300">×</button>
      </div>

      {/* Presets */}
      <div className="flex gap-1 mb-3">
        {COMPRESSOR_PRESETS.map(p => (
          <button
            key={p.id}
            onClick={() => applyPreset(p.id)}
            className="flex-1 text-[10px] py-1 rounded bg-surface-800 hover:bg-surface-700 text-slate-300 font-bold uppercase tracking-wider"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Bypass + HPF row */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => update({ enabled: !settings.enabled })}
          className={`flex-1 text-[10px] py-1 rounded font-bold uppercase tracking-wider ${
            settings.enabled ? 'bg-nar-blue text-white' : 'bg-surface-800 text-slate-500'
          }`}
        >
          {settings.enabled ? 'Compressor ON' : 'Bypass'}
        </button>
        <button
          onClick={() => update({ hpfEnabled: !settings.hpfEnabled })}
          className={`flex-1 text-[10px] py-1 rounded font-bold uppercase tracking-wider ${
            settings.hpfEnabled ? 'bg-nar-amber text-white' : 'bg-surface-800 text-slate-500'
          }`}
          title="Rumble removal — cuts everything below the cutoff frequency."
        >
          HPF {settings.hpfEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* GR meter — 0 to -20 dB, oriented to match a real comp */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-[10px] text-slate-500 uppercase tracking-wider mb-1">
          <span>Gain Reduction</span>
          <span className="tabular-nums text-slate-300">{gr.toFixed(1)} dB</span>
        </div>
        <div className="h-2 bg-surface-800 rounded overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-nar-amber to-nar-red transition-[width] duration-100"
            style={{ width: `${grPct}%` }}
          />
        </div>
      </div>

      {/* Sliders */}
      <div className="space-y-2">
        <KnobRow
          label="HPF" value={settings.hpfFreq} unit="Hz"
          min={20} max={250} step={5}
          onChange={v => update({ hpfFreq: v })}
        />
        <KnobRow
          label="Threshold" value={settings.threshold} unit="dB"
          min={-40} max={0} step={0.5}
          onChange={v => update({ threshold: v })}
        />
        <KnobRow
          label="Ratio" value={settings.ratio} unit=":1"
          min={1} max={20} step={0.1}
          onChange={v => update({ ratio: v })}
        />
        <KnobRow
          label="Knee" value={settings.knee} unit="dB"
          min={0} max={40} step={0.5}
          onChange={v => update({ knee: v })}
        />
        <KnobRow
          label="Attack" value={settings.attack * 1000} unit="ms"
          min={0.5} max={250} step={0.5}
          onChange={v => update({ attack: v / 1000 })}
        />
        <KnobRow
          label="Release" value={settings.release * 1000} unit="ms"
          min={20} max={1000} step={5}
          onChange={v => update({ release: v / 1000 })}
        />
        <KnobRow
          label="Makeup" value={settings.makeup} unit="dB"
          min={0} max={24} step={0.25}
          onChange={v => update({ makeup: v })}
        />
        <KnobRow
          label="Ceiling" value={settings.ceiling} unit="dBFS"
          min={-6} max={0} step={0.1}
          onChange={v => update({ ceiling: v })}
        />
      </div>

      <div className="mt-3 text-[10px] text-slate-600 leading-relaxed">
        Sits in front of the FFmpeg encoder and the compliance logger — every
        change here is heard by the actual stream within a couple of frames.
      </div>
    </div>
  )
}

function KnobRow({ label, value, unit, min, max, step, onChange }: {
  label: string
  value: number
  unit: string
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider w-16 shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 accent-nar-blue"
      />
      <span className="text-[10px] text-slate-400 tabular-nums w-16 shrink-0 text-right">
        {value.toFixed(unit === ':1' || unit === ' ' ? 1 : unit === 'Hz' ? 0 : 1)} {unit}
      </span>
    </label>
  )
}

/**
 * Compliance logger controls — LOG toggle + live segment size + retention.
 * Lives in the audio strip because it shares the operator's selected device.
 */
function ComplianceStrip() {
  const { status, running, setEnabled, openFolder } = useCompliance()
  const [expanded, setExpanded] = useState(false)
  const mins = status ? Math.floor((status.currentBytes / 1024 / 12) / 60) : 0  // ~12 KB/s @ 96 kbps
  const totalGb = status ? (status.totalBytes / 1024 / 1024 / 1024).toFixed(2) : '0.00'
  const dot = running ? 'bg-nar-red animate-pulse' : status?.enabled ? 'bg-nar-amber' : 'bg-surface-700'
  return (
    <>
      <button
        onClick={() => setEnabled(!status?.enabled)}
        title={
          status?.enabled
            ? `Continuous compliance logging is ON. Segment: ${mins} min, total: ${totalGb} GB. Retention: ${status.retentionDays} days.`
            : 'Continuous compliance logging is OFF. Click to enable Ofcom-style as-broadcast capture.'
        }
        className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wider transition-colors shrink-0 ${
          status?.enabled ? 'bg-surface-700 text-slate-200' : 'bg-surface-700 text-slate-500 hover:text-slate-300'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        LOG
      </button>
      <button
        onClick={() => setExpanded(e => !e)}
        title="Compliance logger settings"
        className="text-xs px-1.5 py-0.5 rounded text-slate-600 hover:text-slate-300 shrink-0"
      >
        {expanded ? '◂' : '▸'}
      </button>
      {expanded && (
        <ComplianceSettings onClose={() => setExpanded(false)} onOpen={openFolder} />
      )}
    </>
  )
}

function ComplianceSettings({ onClose, onOpen }: { onClose: () => void; onOpen: () => void }) {
  const { status, setRetention, setSegment, sweepNow } = useCompliance()
  const [retention, setLocalRetention] = useState(status?.retentionDays ?? 42)
  const [segment, setLocalSegment] = useState(status?.segmentMinutes ?? 60)
  useEffect(() => { if (status) { setLocalRetention(status.retentionDays); setLocalSegment(status.segmentMinutes) } }, [status?.retentionDays, status?.segmentMinutes])
  const totalGb = status ? (status.totalBytes / 1024 / 1024 / 1024).toFixed(2) : '0.00'
  return (
    <div
      className="absolute right-2 top-12 z-50 bg-surface-900 border border-surface-700 rounded p-3 w-72 shadow-2xl"
      onMouseLeave={onClose}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Compliance Logger</span>
        <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-300">×</button>
      </div>
      <div className="text-xs text-slate-500 mb-2 space-y-0.5">
        <div className="flex justify-between"><span>Status</span><span className={status?.enabled ? 'text-nar-amber' : 'text-slate-600'}>{status?.enabled ? 'logging' : 'off'}</span></div>
        <div className="flex justify-between"><span>Segments</span><span className="tabular-nums text-slate-400">{status?.totalSegments ?? 0}</span></div>
        <div className="flex justify-between"><span>Total size</span><span className="tabular-nums text-slate-400">{totalGb} GB</span></div>
        <div className="flex justify-between"><span>Oldest</span><span className="tabular-nums text-slate-400">{status?.oldestSegmentDate ?? '—'}</span></div>
        {status?.lastError && <div className="text-nar-red truncate" title={status.lastError}>! {status.lastError}</div>}
      </div>
      <div className="space-y-1.5 mb-2">
        <label className="block text-xs text-slate-500">
          Retention <span className="text-slate-400 tabular-nums">{retention} days</span>
          <input
            type="range" min={1} max={120} value={retention}
            onChange={e => setLocalRetention(Number(e.target.value))}
            onMouseUp={() => setRetention(retention)}
            onTouchEnd={() => setRetention(retention)}
            className="w-full accent-nar-blue"
          />
        </label>
        <label className="block text-xs text-slate-500">
          Segment <span className="text-slate-400 tabular-nums">{segment} min</span>
          <input
            type="range" min={5} max={120} step={5} value={segment}
            onChange={e => setLocalSegment(Number(e.target.value))}
            onMouseUp={() => setSegment(segment)}
            onTouchEnd={() => setSegment(segment)}
            className="w-full accent-nar-blue"
          />
        </label>
      </div>
      <div className="flex gap-1">
        <button onClick={onOpen}
          className="flex-1 text-[10px] py-1 rounded bg-surface-700 hover:bg-surface-600 text-slate-300 font-bold uppercase tracking-wider">
          Open Folder
        </button>
        <button onClick={sweepNow}
          className="flex-1 text-[10px] py-1 rounded bg-surface-700 hover:bg-surface-600 text-slate-300 font-bold uppercase tracking-wider"
          title="Run retention sweep now">
          Sweep
        </button>
      </div>
    </div>
  )
}

function VizGainSlider() {
  const { audioGain, setAudioGain, brightness, setBrightness, bloomAmount, setBloomAmount } = useViz()
  return (
    <>
      <div
        className="flex items-center gap-1.5 shrink-0"
        title="Visualizer input gain — only affects how reactive the on-air graphics are. Does not change what the stream or recorder hear."
      >
        <span className="text-xs text-slate-600 font-bold uppercase tracking-wider">Viz</span>
        <input
          type="range" min={0} max={400} value={audioGain}
          onChange={e => setAudioGain(Number(e.target.value))}
          className="w-20 accent-nar-amber"
        />
        <span className="text-xs text-slate-400 tabular-nums w-9">{audioGain}%</span>
      </div>
      {/* Master visual brightness — multiplied at the end of the composite,
          so 0 paints true black regardless of bloom/flares/grain. */}
      <div
        className="flex items-center gap-1.5 shrink-0"
        title="Visualizer output brightness — master multiplier applied after bloom + post-fx. 0 = black, 100 = unity."
      >
        <span className="text-xs text-slate-600 font-bold uppercase tracking-wider">Brt</span>
        <input
          type="range" min={0} max={150} value={brightness}
          onChange={e => setBrightness(Number(e.target.value))}
          className="w-20 accent-nar-amber"
        />
        <span className="text-xs text-slate-400 tabular-nums w-9">{brightness}%</span>
      </div>
      {/* Bloom dose — single knob over bloom + anamorphic flare + lens dirt */}
      <div
        className="flex items-center gap-1.5 shrink-0"
        title="Bloom dose — scales the bloom + anamorphic flare + lens dirt together. 0 = no glow, 100 = unity."
      >
        <span className="text-xs text-slate-600 font-bold uppercase tracking-wider">Bloom</span>
        <input
          type="range" min={0} max={200} value={bloomAmount}
          onChange={e => setBloomAmount(Number(e.target.value))}
          className="w-20 accent-nar-amber"
        />
        <span className="text-xs text-slate-400 tabular-nums w-9">{bloomAmount}%</span>
      </div>
    </>
  )
}

function VUMeter({ level, peak, label }: { level: number; peak: number; label: string }) {
  const SEGMENTS = 20
  const YELLOW_FROM = 14
  const RED_FROM = 18
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex gap-px">
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const seg = SEGMENTS - 1 - i
          const active = level * SEGMENTS > seg
          const isPeak = Math.round(peak * SEGMENTS) === seg + 1
          const isRed = seg >= RED_FROM
          const isYellow = seg >= YELLOW_FROM && seg < RED_FROM
          let colour = 'bg-surface-700'
          if (isPeak && peak > 0) colour = 'bg-white'
          else if (active) colour = isRed ? 'bg-nar-red' : isYellow ? 'bg-nar-amber' : 'bg-nar-green'
          return <div key={i} className={`w-2 h-1 rounded-sm transition-none ${colour}`} />
        })}
      </div>
      <span className="text-xs text-slate-700">{label}</span>
    </div>
  )
}
