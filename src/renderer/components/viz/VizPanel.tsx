import { useEffect, useMemo, useRef, useState } from 'react'
import { useViz, useVizActive, VIZ_MODES, VIZ_GROUPS, VIZ_PALETTES } from '../../viz/VizProvider'
import { useEngine } from '../../engine/EngineProvider'
import { VIZ_SLOT } from '../../engine/types'
import { useOsc } from '../../external/OscBridge'
import { useUnreal } from '../../external/UnrealLauncher'

type Group = typeof VIZ_GROUPS[number]
type Tab = 'All' | Group | 'Custom'

// Group-coloured accent stripe on each tile, so the eye can scan by category.
const GROUP_ACCENT: Record<Group, string> = {
  Geometric: '#e5202b',   // brand red
  Artistic: '#f7931e',    // brand orange
  Meters: '#3b82f6',      // nar-blue
}

export function VizPanel() {
  const viz = useViz()
  const engine = useEngine()
  // The panel shows a live preview — keep the visualizer rendering while open.
  useVizActive(true)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const [levels, setLevels] = useState({
    bass: 0, mid: 0, treble: 0, level: 0, beat: 0, beatAt: 0, centroid: 0, beatPhase: 0,
    bpm: 0, bpmConfident: false,
  })
  const [tab, setTab] = useState<Tab>('All')

  const live = engine.programSlots.includes(VIZ_SLOT)
  const builtin = engine.engineId === 'builtin'

  // Mirror the visualizer canvas into the preview; sample levels at ~10fps.
  useEffect(() => {
    let raf = 0
    let frame = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const dst = previewRef.current
      const src = viz.getCanvas()
      if (dst && src) {
        const cw = dst.clientWidth, ch = dst.clientHeight
        if (cw > 0 && ch > 0 && (dst.width !== cw || dst.height !== ch)) {
          dst.width = cw
          dst.height = ch
        }
        const ctx = dst.getContext('2d')
        if (ctx) ctx.drawImage(src, 0, 0, dst.width, dst.height)
      }
      if (++frame % 6 === 0) setLevels({ ...viz.levelsRef.current })
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [viz])

  // Auto-follow — when on, the Live Cam camera tracks whichever camera is
  // on program. Operator picking a specific camera turns it back to manual.
  useEffect(() => {
    if (!viz.camAuto) return
    const progCam = engine.programSlots.find(s => s >= 0 && s <= 3)
    if (progCam !== undefined && progCam !== viz.camPick) viz.setCamPick(progCam)
  }, [engine.programSlots, viz.camAuto, viz.camPick, viz.setCamPick])

  const filteredModes = useMemo(() => {
    if (tab === 'All') return VIZ_MODES
    if (tab === 'Custom') return []
    return VIZ_MODES.filter(m => m.group === tab)
  }, [tab])
  const showCustom = tab === 'All' || tab === 'Custom'

  return (
    <div className="flex flex-col gap-3 p-3 h-full overflow-y-auto">
      <span className="text-xs text-slate-500 uppercase tracking-wider">Music Visualizer</span>

      {/* Live preview */}
      <div className="relative">
        <canvas ref={previewRef} className="w-full aspect-video rounded bg-black border border-surface-700" />
        {live && (
          <span className="absolute top-1.5 left-1.5 text-[10px] font-bold bg-nar-red text-white px-1.5 py-0.5 rounded uppercase tracking-wider animate-pulse">
            On Air
          </span>
        )}
        <span
          className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full"
          style={{ background: '#e5202b', opacity: 0.2 + levels.beat * 0.8 }}
          title="Beat detector"
        />
      </div>

      {/* Cut to Program */}
      <button
        onClick={() => engine.cut('viz')}
        disabled={!builtin}
        title={builtin ? 'Cut the visualizer to air' : 'Available on the built-in engine only'}
        className={`text-sm font-bold uppercase tracking-widest py-2.5 rounded transition-colors ${
          live
            ? 'bg-nar-red text-white'
            : builtin
            ? 'bg-surface-800 text-slate-300 hover:bg-nar-red hover:text-white'
            : 'bg-surface-800 text-slate-700 cursor-not-allowed'
        }`}
      >
        {live ? '● On Air' : 'Cut to Program'}
      </button>

      {/* Group filter tabs */}
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider">
        {(['All', ...VIZ_GROUPS, 'Custom'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded transition-colors ${
              tab === t ? 'bg-surface-700 text-white' : 'bg-surface-900 text-slate-500 hover:text-slate-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Mode tiles */}
      <div className="grid grid-cols-2 gap-1.5">
        {filteredModes.map(m => {
          const selected = !viz.customMode && viz.mode === m.id
          return (
            <button
              key={m.id}
              onClick={() => viz.setMode(m.id)}
              title={m.hint}
              className={`group relative flex items-stretch gap-2 p-2 rounded text-left transition-all ${
                selected
                  ? 'bg-surface-700 ring-2 ring-nar-blue shadow-[0_0_0_1px_rgba(59,130,246,0.2)]'
                  : 'bg-surface-800 hover:bg-surface-700'
              }`}
            >
              <span className="w-1.5 rounded-full shrink-0" style={{ background: GROUP_ACCENT[m.group as Group] }} />
              <span className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-bold text-white truncate">{m.label}</span>
                <span className="text-[10px] text-slate-500 truncate leading-tight">{m.hint}</span>
              </span>
            </button>
          )
        })}

        {showCustom && viz.customShaders.map(name => {
          const selected = viz.customMode === name
          return (
            <button
              key={`custom-${name}`}
              onClick={() => viz.setCustomMode(name)}
              title={`Custom shader — ${name}`}
              className={`group relative flex items-stretch gap-2 p-2 rounded text-left transition-all ${
                selected
                  ? 'bg-surface-700 ring-2 ring-nar-blue shadow-[0_0_0_1px_rgba(59,130,246,0.2)]'
                  : 'bg-surface-800 hover:bg-surface-700'
              }`}
            >
              <span className="w-1.5 rounded-full shrink-0 bg-gradient-to-b from-nar-amber to-nar-red" />
              <span className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-bold text-white truncate">{name}</span>
                <span className="text-[10px] text-slate-500 truncate leading-tight">Custom shader</span>
              </span>
            </button>
          )
        })}

        {tab === 'Custom' && viz.customShaders.length === 0 && (
          <div className="col-span-2 text-[10px] text-slate-600 italic p-3 bg-surface-900 rounded border border-dashed border-surface-700">
            No custom shaders yet. Drop a .glsl/.fs/.frag file into the shader folder to add one.
          </div>
        )}
      </div>

      {/* Countdown controls — only shown for the Countdown mode */}
      {viz.mode === 33 && !viz.customMode && (
        <div className="flex items-center gap-1 -mt-1">
          <span className="text-[10px] text-slate-600 uppercase tracking-wider shrink-0 mr-1">Start</span>
          {[10, 15, 30, 60].map(s => (
            <button
              key={s}
              onClick={() => viz.startCountdown(s)}
              className="flex-1 text-[10px] py-1 rounded font-bold bg-surface-800 text-slate-300 hover:bg-nar-amber hover:text-white transition-colors"
            >
              {s}s
            </button>
          ))}
          <button
            onClick={() => viz.stopCountdown()}
            className="text-[10px] py-1 px-2 rounded font-bold bg-surface-800 text-slate-400 hover:bg-nar-red hover:text-white transition-colors"
          >
            STOP
          </button>
        </div>
      )}

      {/* Camera picker — shown for any live-camera mode */}
      {(viz.mode === 28 || viz.mode === 29 || viz.mode === 30) && !viz.customMode && (
        <div className="flex items-center gap-1 -mt-1">
          <span className="text-[10px] text-slate-600 uppercase tracking-wider shrink-0 mr-1">Cam</span>
          <button
            onClick={() => viz.setCamAuto(!viz.camAuto)}
            title="Follow whichever camera is currently on program"
            className={`flex-1 text-[10px] py-1 rounded font-bold transition-colors ${
              viz.camAuto
                ? 'bg-nar-blue text-white'
                : 'bg-surface-800 text-slate-400 hover:text-white'
            }`}
          >
            AUTO
          </button>
          {[0, 1, 2, 3].map(i => (
            <button
              key={i}
              onClick={() => { viz.setCamAuto(false); viz.setCamPick(i) }}
              className={`flex-1 text-[10px] py-1 rounded font-bold transition-colors ${
                !viz.camAuto && viz.camPick === i
                  ? 'bg-nar-red text-white'
                  : 'bg-surface-800 text-slate-400 hover:text-white'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={() => viz.openShaderFolder()}
        title="Open the folder where custom shaders live"
        className="text-[10px] text-slate-600 hover:text-slate-300 text-left -mt-1"
      >
        Open shader folder →
      </button>

      {/* Palette */}
      <span className="text-xs text-slate-500 uppercase tracking-wider mt-1">Palette</span>
      <div className="grid grid-cols-3 gap-1">
        {VIZ_PALETTES.map(p => (
          <button
            key={p.id}
            onClick={() => viz.setPalette(p.id)}
            className={`flex items-center gap-1.5 text-[10px] py-1.5 px-1.5 rounded transition-colors ${
              viz.palette === p.id
                ? 'bg-surface-700 text-white ring-1 ring-nar-blue/60'
                : 'bg-surface-800 text-slate-400 hover:text-white'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.swatch }} />
            <span className="truncate">{p.label}</span>
          </button>
        ))}
      </div>

      {/* Intensity + look toggles */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-600 uppercase tracking-wider shrink-0">Intensity</span>
        <input
          type="range" min={0.3} max={2.5} step={0.05} value={viz.intensity}
          onChange={e => viz.setIntensity(Number(e.target.value))}
          className="flex-1 accent-nar-blue"
        />
        <span className="text-[10px] text-slate-400 tabular-nums w-8">{viz.intensity.toFixed(2)}</span>
      </div>

      <div className="flex gap-1">
        <button
          onClick={() => viz.setKaleido(!viz.kaleido)}
          title="6-fold kaleidoscope fold on the output"
          className={`flex-1 text-[10px] py-1.5 rounded font-bold uppercase tracking-wider transition-colors ${
            viz.kaleido ? 'bg-nar-blue text-white' : 'bg-surface-800 text-slate-400 hover:text-white'
          }`}
        >
          Kaleido
        </button>
        <button
          onClick={() => viz.setAutoCycle(!viz.autoCycle)}
          title="Pace-aware mode rotation — every 32 detected beats, with a 60s safety fallback"
          className={`flex-1 text-[10px] py-1.5 rounded font-bold uppercase tracking-wider transition-colors ${
            viz.autoCycle ? 'bg-nar-blue text-white' : 'bg-surface-800 text-slate-400 hover:text-white'
          }`}
        >
          Auto-Cycle
        </button>
      </div>

      {/* Audio status + live pace (BPM) */}
      <div className="flex items-center justify-between gap-2 mt-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${viz.audioActive ? 'bg-nar-green' : 'bg-nar-amber'}`} />
          <span className="text-[10px] text-slate-500 truncate">
            {viz.audioActive ? 'Reacting to studio audio' : 'No audio — idle'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0" title={
          levels.bpmConfident
            ? 'Pace locked — tempo-driven triggers active'
            : 'Listening for a stable tempo…'
        }>
          <div
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: '#f7931e', opacity: 0.22 + levels.beat * 0.78 }}
          />
          <span className={`text-[10px] tabular-nums font-bold ${
            viz.audioActive && levels.bpm > 50 && levels.bpmConfident
              ? 'text-nar-amber'
              : 'text-slate-600'
          }`}>
            {viz.audioActive && levels.bpm > 50 ? `${Math.round(levels.bpm)} BPM` : '— BPM'}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {([
          ['Bass', levels.bass, '#e5202b'],
          ['Mid', levels.mid, '#f7931e'],
          ['Treble', levels.treble, '#3b82f6'],
        ] as const).map(([label, v, color]) => (
          <div key={label} className="flex items-center gap-2">
            <span className="text-[10px] text-slate-600 w-12 shrink-0 uppercase tracking-wider">{label}</span>
            <div className="flex-1 h-1.5 bg-surface-800 rounded overflow-hidden">
              <div
                className="h-full rounded"
                style={{ width: `${Math.min(100, v * 140)}%`, background: color }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* External engine bridge — drives Unreal / TouchDesigner / Resolume
          / Notch via OSC. The same metric stream the built-in WebGL viz
          consumes is pumped out on the wire at 30 Hz. */}
      <ExternalEngineSection />

      {/* Unreal Engine companion launcher — spawn + supervise UE as a child
          process so the operator never has to alt-tab to start visuals. */}
      <UnrealLauncherSection />

      {/* Hint the operator toward the NDI virtual-webcam that turns UE's
          render output into one of NAR Studio's camera inputs. */}
      <NdiSourceHintSection />

      <span className="text-[10px] text-slate-700 mt-1">Shortcut: press V to cut the visualizer to air.</span>
    </div>
  )
}

function ExternalEngineSection() {
  const { status, setEnabled, setHost, setPort } = useOsc()
  const [host, setLocalHost] = useState(status?.host ?? '127.0.0.1')
  const [port, setLocalPort] = useState(status?.port ?? 9000)
  useEffect(() => {
    if (status) { setLocalHost(status.host); setLocalPort(status.port) }
  }, [status?.host, status?.port])
  const on = !!status?.enabled
  return (
    <div className="flex flex-col gap-1 mt-2 pt-2 border-t border-surface-800">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-600 uppercase tracking-wider">External Engine · OSC</span>
        <button
          onClick={() => setEnabled(!on)}
          title="Pump BPM / beat / level / bands out as OSC at 30 Hz. Drives Unreal Engine, TouchDesigner, Resolume, Notch, vvvv."
          className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider transition-colors ${
            on ? 'bg-nar-blue text-white' : 'bg-surface-800 text-slate-500 hover:text-slate-300'
          }`}
        >
          {on ? 'OUT' : 'OFF'}
        </button>
      </div>
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={host}
          onChange={e => setLocalHost(e.target.value)}
          onBlur={() => setHost(host)}
          placeholder="127.0.0.1"
          className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-0.5 text-[10px] font-mono text-slate-200 outline-none focus:border-nar-blue/60"
        />
        <input
          type="number"
          min={1} max={65535}
          value={port}
          onChange={e => setLocalPort(Number(e.target.value))}
          onBlur={() => setPort(port)}
          className="w-16 bg-surface-800 border border-surface-700 rounded px-2 py-0.5 text-[10px] font-mono text-slate-200 outline-none focus:border-nar-blue/60"
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-slate-600">
        <span>
          {on ? `${status?.rate ?? 0} msg/s` : 'enable to drive Unreal/TD/Resolume'}
        </span>
        {status?.lastError && (
          <span className="text-nar-red truncate max-w-[60%]" title={status.lastError}>
            ! {status.lastError}
          </span>
        )}
      </div>
      <span className="text-[10px] text-slate-700 leading-snug mt-0.5">
        Receivers listen on UDP {host}:{port}. Addresses: <span className="font-mono">/nar/bpm</span>
        {' '}<span className="font-mono">/nar/beat</span> <span className="font-mono">/nar/level</span>
        {' '}<span className="font-mono">/nar/bass</span> <span className="font-mono">/nar/mid</span>
        {' '}<span className="font-mono">/nar/treble</span> <span className="font-mono">/nar/beatPhase</span>
        {' '}<span className="font-mono">/nar/centroid</span> <span className="font-mono">/nar/lufs</span>
      </span>
    </div>
  )
}

/**
 * Process-control panel for the Unreal Engine companion. The launcher in
 * main owns crash recovery + lifecycle; this component is purely the UI:
 * file pickers for the exe + .uproject, a Start / Stop button that mirrors
 * the live state, and small toggles for auto-launch and background mode.
 */
function UnrealLauncherSection() {
  const u = useUnreal()
  const s = u.status
  const [extraArgs, setLocalExtraArgs] = useState(s?.extraArgs ?? '')
  useEffect(() => { if (s) setLocalExtraArgs(s.extraArgs) }, [s?.extraArgs])

  const stateColor =
    s?.state === 'running' ? 'bg-nar-green' :
    s?.state === 'starting' ? 'bg-nar-amber animate-pulse' :
    s?.state === 'crashed' ? 'bg-nar-red animate-pulse' :
    'bg-surface-700'
  const stateLabel = s?.state ?? 'idle'
  const ready = !!s?.unrealExe
  const running = s?.state === 'running' || s?.state === 'starting'

  return (
    <div className="flex flex-col gap-1 mt-2 pt-2 border-t border-surface-800">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-600 uppercase tracking-wider">Unreal Engine · Process</span>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${stateColor}`} />
          <span className="text-[10px] tabular-nums text-slate-500 uppercase tracking-wider">{stateLabel}</span>
          {s?.pid && <span className="text-[10px] text-slate-700 font-mono">pid {s.pid}</span>}
        </div>
      </div>

      {/* UE executable picker */}
      <div className="flex items-center gap-1">
        <button
          onClick={u.pickExe}
          className="text-[10px] py-1 px-2 rounded bg-surface-800 hover:bg-surface-700 text-slate-300 font-bold uppercase tracking-wider"
        >
          {s?.unrealExe ? 'Change UE' : 'Locate UnrealEditor.exe'}
        </button>
        <span className="text-[10px] text-slate-600 truncate flex-1 font-mono" title={s?.unrealExe}>
          {s?.unrealExe ? s.unrealExe.split(/[\\/]/).slice(-2).join('/') : '—'}
        </span>
      </div>

      {/* .uproject picker */}
      <div className="flex items-center gap-1">
        <button
          onClick={u.pickProject}
          className="text-[10px] py-1 px-2 rounded bg-surface-800 hover:bg-surface-700 text-slate-300 font-bold uppercase tracking-wider"
        >
          {s?.projectPath ? 'Change project' : 'Pick .uproject'}
        </button>
        <span className="text-[10px] text-slate-600 truncate flex-1 font-mono" title={s?.projectPath}>
          {s?.projectPath ? s.projectPath.split(/[\\/]/).slice(-1)[0] : '—'}
        </span>
      </div>

      {/* Extra args + commit-on-blur */}
      <input
        type="text"
        value={extraArgs}
        onChange={e => setLocalExtraArgs(e.target.value)}
        onBlur={() => u.setExtraArgs(extraArgs)}
        placeholder="-ResX=1920 -ResY=1080 -WINDOWED"
        className="bg-surface-800 border border-surface-700 rounded px-2 py-0.5 text-[10px] font-mono text-slate-200 outline-none focus:border-nar-blue/60"
      />

      {/* Control row */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => running ? u.stop() : u.start()}
          disabled={!ready}
          className={`flex-1 text-[10px] py-1 rounded font-bold uppercase tracking-wider transition-colors ${
            !ready ? 'bg-surface-800 text-slate-700 cursor-not-allowed'
              : running ? 'bg-nar-red text-white hover:bg-red-600'
              : 'bg-nar-blue text-white hover:bg-blue-500'
          }`}
        >
          {running ? 'Stop UE' : 'Launch UE'}
        </button>
        <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer">
          <input
            type="checkbox"
            checked={!!s?.autoLaunch}
            onChange={e => u.setAutoLaunch(e.target.checked)}
            className="accent-nar-blue"
          />
          Auto
        </label>
        <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer" title="Run UE windowed in the background (no taskbar pop).">
          <input
            type="checkbox"
            checked={!!s?.background}
            onChange={e => u.setBackground(e.target.checked)}
            className="accent-nar-blue"
          />
          Bg
        </label>
      </div>

      {/* Status line */}
      {s?.crashCount ? (
        <span className="text-[10px] text-nar-amber">
          {s.crashCount} restart{s.crashCount === 1 ? '' : 's'} this session
        </span>
      ) : null}
      {s?.lastError && (
        <span className="text-[10px] text-nar-red truncate" title={s.lastError}>! {s.lastError}</span>
      )}
      <span className="text-[10px] text-slate-700 leading-snug">
        Point this at UnrealEditor.exe + your <span className="font-mono">unreal-companion/NarVisualizer.uproject</span> for the first run. Auto-restart kicks in for the first 5 crashes with exponential backoff.
      </span>
    </div>
  )
}

/**
 * Surfaces any NDI / Spout / virtual-camera device that's already plugged
 * into the system, so the operator immediately sees where to route the UE
 * output. We just enumerate webcam devices and highlight the ones whose
 * name screams "I'm an NDI bridge".
 */
function NdiSourceHintSection() {
  const [bridges, setBridges] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    let cancelled = false
    const probe = async () => {
      try {
        // Trigger a permission prompt the first time so labels populate.
        await navigator.mediaDevices.getUserMedia({ video: true }).then(s => s.getTracks().forEach(t => t.stop())).catch(() => {})
        const all = await navigator.mediaDevices.enumerateDevices()
        if (cancelled) return
        const bridgeRe = /ndi|spout|newtek|sienna|virtual cam|obs virtual/i
        setBridges(all.filter(d => d.kind === 'videoinput' && bridgeRe.test(d.label)))
      } catch { /* ignore */ }
    }
    probe()
    navigator.mediaDevices.addEventListener('devicechange', probe)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener('devicechange', probe)
    }
  }, [])
  return (
    <div className="flex flex-col gap-1 mt-2 pt-2 border-t border-surface-800">
      <span className="text-[10px] text-slate-600 uppercase tracking-wider">UE Video Return · NDI / Spout</span>
      {bridges.length === 0 ? (
        <span className="text-[10px] text-slate-700 leading-snug">
          No NDI / Spout virtual webcam detected. Install <span className="font-mono">NDI Tools</span> (free) and run <span className="font-mono">NewTek NDI Webcam Input</span> alongside UE — it exposes your UE viewport as a Windows webcam that this app can pick up as CAM 1–4.
        </span>
      ) : (
        <>
          <span className="text-[10px] text-nar-green">
            Found {bridges.length} bridge{bridges.length === 1 ? '' : 's'}:
          </span>
          <ul className="text-[10px] font-mono text-slate-300 list-disc list-inside leading-snug">
            {bridges.map(b => <li key={b.deviceId} className="truncate" title={b.label}>{b.label}</li>)}
          </ul>
          <span className="text-[10px] text-slate-700 leading-snug">
            Point one of CAM 1–4 at the bridge in the camera selector — UE's render output cuts to air like any other camera.
          </span>
        </>
      )}
    </div>
  )
}
