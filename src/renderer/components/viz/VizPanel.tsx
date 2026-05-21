import { useEffect, useRef, useState } from 'react'
import { useViz, useVizActive, VIZ_MODES, VIZ_GROUPS, VIZ_PALETTES } from '../../viz/VizProvider'
import { useEngine } from '../../engine/EngineProvider'
import { VIZ_SLOT } from '../../engine/types'

export function VizPanel() {
  const viz = useViz()
  const engine = useEngine()
  // The panel shows a live preview — keep the visualizer rendering while open.
  useVizActive(true)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const [levels, setLevels] = useState({
    bass: 0, mid: 0, treble: 0, level: 0, beat: 0, beatAt: 0, centroid: 0, beatPhase: 0,
  })

  const live = engine.programSlots.includes(VIZ_SLOT)
  const builtin = engine.engineId === 'builtin'

  // Mirror the visualizer canvas into the panel preview; sample levels at ~10fps.
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

  return (
    <div className="flex flex-col gap-2 p-3 h-full overflow-y-auto">
      <span className="text-xs text-slate-500 uppercase tracking-wider">Music Visualizer</span>

      {/* Live preview of the visualizer output */}
      <div className="relative">
        <canvas ref={previewRef} className="w-full aspect-video rounded bg-black border border-surface-700" />
        {live && (
          <span className="absolute top-1.5 left-1.5 text-xs font-bold bg-nar-red text-white px-1.5 py-0.5 rounded animate-pulse">
            PGM
          </span>
        )}
        <span
          className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full"
          style={{ background: '#e8003c', opacity: 0.2 + levels.beat * 0.8 }}
          title="Beat detector"
        />
      </div>

      {/* Instant cut — honours the live-cutting workflow */}
      <button
        onClick={() => engine.cut('viz')}
        disabled={!builtin}
        title={builtin ? 'Cut the visualizer to air' : 'Available on the built-in engine only'}
        className={`text-xs font-bold uppercase tracking-widest py-2 rounded transition-colors ${
          live
            ? 'bg-nar-red text-white'
            : builtin
            ? 'bg-surface-800 text-slate-300 hover:bg-nar-red hover:text-white'
            : 'bg-surface-800 text-slate-700 cursor-not-allowed'
        }`}
      >
        {live ? '● On Air' : 'Cut to Program'}
      </button>

      {/* Mode — grouped so the modes stay easy to scan */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-600 uppercase tracking-wider">Mode</span>
        <button
          onClick={() => viz.openShaderFolder()}
          title="Open the folder where custom shaders live"
          className="text-xs text-slate-600 hover:text-slate-300"
        >
          Shader folder
        </button>
      </div>
      {VIZ_GROUPS.map(group => (
        <div key={group} className="flex flex-col gap-1">
          <span className="text-[9px] font-medium uppercase tracking-wider text-slate-600">{group}</span>
          <div className="grid grid-cols-3 gap-1">
            {VIZ_MODES.filter(m => m.group === group).map(m => (
              <button
                key={m.id}
                onClick={() => viz.setMode(m.id)}
                title={m.hint}
                className={`text-xs py-1.5 rounded transition-colors ${
                  !viz.customMode && viz.mode === m.id
                    ? 'bg-nar-blue text-white' : 'bg-surface-800 text-slate-400 hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {viz.customShaders.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-medium uppercase tracking-wider text-slate-600">Custom</span>
          <div className="grid grid-cols-3 gap-1">
            {viz.customShaders.map(name => (
              <button
                key={name}
                onClick={() => viz.setCustomMode(name)}
                title={`Custom shader — ${name}`}
                className={`text-xs py-1.5 px-1 rounded truncate transition-colors ${
                  viz.customMode === name
                    ? 'bg-nar-blue text-white' : 'bg-surface-800 text-slate-400 hover:text-white'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Palette */}
      <span className="text-xs text-slate-600 uppercase tracking-wider">Palette</span>
      <div className="grid grid-cols-2 gap-1">
        {VIZ_PALETTES.map(p => (
          <button
            key={p.id}
            onClick={() => viz.setPalette(p.id)}
            className={`flex items-center gap-1.5 text-xs py-1.5 px-2 rounded transition-colors ${
              viz.palette === p.id
                ? 'bg-surface-700 text-white border border-nar-blue/60'
                : 'bg-surface-800 text-slate-400 hover:text-white'
            }`}
          >
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: p.swatch }} />
            {p.label}
          </button>
        ))}
      </div>

      {/* Intensity */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-600 uppercase tracking-wider shrink-0">Intensity</span>
        <input
          type="range" min={0.3} max={2.5} step={0.05} value={viz.intensity}
          onChange={e => viz.setIntensity(Number(e.target.value))}
          className="flex-1 accent-nar-blue"
        />
        <span className="text-xs text-slate-400 tabular-nums w-8">{viz.intensity.toFixed(2)}</span>
      </div>

      {/* Look toggles */}
      <div className="flex gap-1">
        <button
          onClick={() => viz.setKaleido(!viz.kaleido)}
          title="6-fold kaleidoscope fold on the output"
          className={`flex-1 text-xs py-1.5 rounded font-bold transition-colors ${
            viz.kaleido ? 'bg-nar-blue text-white' : 'bg-surface-800 text-slate-400 hover:text-white'
          }`}
        >
          Kaleidoscope
        </button>
        <button
          onClick={() => viz.setAutoCycle(!viz.autoCycle)}
          title="Rotate through the modes every 30s so a long show stays fresh"
          className={`flex-1 text-xs py-1.5 rounded font-bold transition-colors ${
            viz.autoCycle ? 'bg-nar-blue text-white' : 'bg-surface-800 text-slate-400 hover:text-white'
          }`}
        >
          Auto-Cycle
        </button>
      </div>

      {/* Audio reactivity status */}
      <div className="flex items-center gap-1.5 mt-1">
        <div className={`w-1.5 h-1.5 rounded-full ${viz.audioActive ? 'bg-nar-green' : 'bg-nar-amber'}`} />
        <span className="text-xs text-slate-500">
          {viz.audioActive ? 'Reacting to studio audio' : 'No audio — idle animation'}
        </span>
      </div>

      {/* Band meters */}
      <div className="flex flex-col gap-1">
        {([
          ['Bass', levels.bass, '#e8003c'],
          ['Mid', levels.mid, '#f59e0b'],
          ['Treble', levels.treble, '#3b82f6'],
        ] as const).map(([label, v, color]) => (
          <div key={label} className="flex items-center gap-2">
            <span className="text-xs text-slate-600 w-12 shrink-0">{label}</span>
            <div className="flex-1 h-1.5 bg-surface-800 rounded overflow-hidden">
              <div
                className="h-full rounded"
                style={{ width: `${Math.min(100, v * 140)}%`, background: color }}
              />
            </div>
          </div>
        ))}
      </div>

      <span className="text-xs text-slate-700 mt-1">Shortcut: press V to cut the visualizer to air.</span>
    </div>
  )
}
