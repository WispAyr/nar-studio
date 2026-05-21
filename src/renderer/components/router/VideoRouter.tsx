import { useEngine } from '../../engine/EngineProvider'
import { VIZ_SLOT, type LayoutType } from '../../engine/types'

const OUTPUTS = [
  { id: 'program', label: 'PGM', hint: 'Program — the live output', color: 'border-nar-red text-nar-red' },
  { id: 'stream', label: 'RTMP', hint: 'Stream output — always follows Program', color: 'border-nar-amber text-nar-amber' },
]

const LAYOUTS: { id: LayoutType; label: string }[] = [
  { id: 'solo', label: 'Solo' },
  { id: 'split', label: 'Split' },
  { id: 'pip', label: 'PiP' },
]

const TRANSITION_HINTS: Record<string, string> = {
  cut: 'Instant hard cut',
  fade: 'Crossfade between shots',
  dip: 'Dip through black',
  reactive: 'Audio-reactive — flashes on a beat, dissolves softly when quiet',
}

const SLOT_LABELS: Record<LayoutType, string[]> = {
  solo: ['Program'],
  split: ['Left', 'Right'],
  pip: ['Main', 'Inset'],
}

export function VideoRouter() {
  const {
    engineId, programSource, programCams, sources, obsScenes, cut,
    transition, setTransition, layout, setLayout, programSlots, activeSlot, setActiveSlot,
    beatFx, setBeatFx, autoVj, setAutoVj, autoVjHold, setAutoVjHold,
    autoVjViz, setAutoVjViz, autoVjLayouts, setAutoVjLayouts, dropToViz, setDropToViz,
  } = useEngine()

  const inProgram = (key: string) =>
    key === 'viz' ? programSlots.includes(VIZ_SLOT) : programCams.includes(Number(key.slice(3)))

  return (
    <div className="flex flex-col gap-2 p-3 h-full overflow-y-auto">
      <span className="text-xs text-slate-500 uppercase tracking-wider">Video Router</span>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left text-slate-600 pb-1 pr-2 font-normal">Source</th>
              {OUTPUTS.map(out => (
                <th
                  key={out.id}
                  title={out.hint}
                  className={`text-center pb-1 px-2 font-bold border-b ${out.color}`}
                >
                  {out.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sources.map(src => {
              const live = inProgram(src.key)
              return (
                <tr key={src.key} className="border-b border-surface-800">
                  <td className="py-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${src.hasSignal ? 'bg-nar-green' : 'bg-surface-600'}`} />
                      <span className={src.hasSignal ? 'text-slate-300' : 'text-slate-600'}>{src.label}</span>
                    </div>
                  </td>

                  {/* PGM routing — fills the active layout slot */}
                  <td className="py-1 px-2 text-center">
                    <button
                      onClick={() => cut(src.key)}
                      className={`w-6 h-6 rounded transition-colors ${
                        live
                          ? 'bg-nar-red text-white'
                          : 'bg-surface-800 hover:bg-surface-700 text-slate-600 hover:text-slate-300'
                      }`}
                    >
                      {live ? '●' : '○'}
                    </button>
                  </td>

                  {/* RTMP follows PGM */}
                  <td className="py-1 px-2 text-center">
                    <div className={`w-6 h-6 rounded flex items-center justify-center mx-auto ${
                      live ? 'text-nar-amber' : 'text-slate-700'
                    }`}>
                      {live ? '●' : '○'}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Program layout (built-in) */}
      {engineId === 'builtin' && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600 uppercase tracking-wider shrink-0">Layout</span>
            <div className="flex gap-1 flex-1">
              {LAYOUTS.map(l => (
                <button
                  key={l.id}
                  onClick={() => setLayout(l.id)}
                  className={`flex-1 text-xs py-1 rounded transition-colors ${
                    layout === l.id ? 'bg-nar-blue text-white' : 'bg-surface-800 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          {layout !== 'solo' && (
            <div className="flex gap-1">
              {programSlots.map((cam, i) => (
                <button
                  key={i}
                  onClick={() => setActiveSlot(i)}
                  title="Select this slot, then pick a camera"
                  className={`flex-1 text-xs py-1 rounded transition-colors ${
                    activeSlot === i
                      ? 'bg-surface-700 text-nar-amber border border-nar-amber/50'
                      : 'bg-surface-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {SLOT_LABELS[layout][i]} · CAM {cam + 1}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Transition style for built-in cuts */}
      {engineId === 'builtin' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-600 uppercase tracking-wider shrink-0">Transition</span>
          <div className="flex gap-1 flex-1">
            {(['cut', 'fade', 'dip', 'reactive'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTransition(t)}
                title={TRANSITION_HINTS[t]}
                className={`flex-1 text-xs py-1 rounded capitalize transition-colors ${
                  transition === t ? 'bg-nar-blue text-white' : 'bg-surface-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Audio-reactive switching & FX — built-in engine */}
      {engineId === 'builtin' && (
        <div className="flex flex-col gap-1.5 pt-1.5 border-t border-surface-800">
          <span className="text-xs text-slate-600 uppercase tracking-wider">Audio Reactive</span>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoVj(!autoVj)}
              title="Autopilot — cuts cameras on the beat. Any manual cut overrides instantly."
              className={`text-xs w-[88px] py-1 rounded font-bold transition-colors shrink-0 ${
                autoVj ? 'bg-nar-green text-black' : 'bg-surface-800 text-slate-500 hover:text-slate-300'
              }`}
            >
              Auto-VJ
            </button>
            <span className="text-xs text-slate-600 flex-1">cuts cams on the beat</span>
          </div>
          {autoVj && (
            <div className="flex items-center gap-2 pl-1">
              <span className="text-xs text-slate-600 shrink-0">Hold</span>
              <input
                type="range" min={0.8} max={6} step={0.1} value={autoVjHold}
                onChange={e => setAutoVjHold(Number(e.target.value))}
                className="flex-1 accent-nar-blue"
              />
              <span className="text-xs text-slate-400 tabular-nums w-9">{autoVjHold.toFixed(1)}s</span>
            </div>
          )}
          {autoVj && (
            <div className="flex items-center gap-2 pl-1">
              <button
                onClick={() => setAutoVjViz(!autoVjViz)}
                title="Let the director cut to the music visualizer between camera shots"
                className={`text-xs w-[88px] py-1 rounded font-bold transition-colors shrink-0 ${
                  autoVjViz ? 'bg-nar-green text-black' : 'bg-surface-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                Visuals
              </button>
              <span className="text-xs text-slate-600 flex-1">director uses the visualizer</span>
            </div>
          )}
          {autoVj && (
            <div className="flex items-center gap-2 pl-1">
              <button
                onClick={() => setAutoVjLayouts(!autoVjLayouts)}
                title="Let the director use split / PiP — only when two cameras each have someone in frame"
                className={`text-xs w-[88px] py-1 rounded font-bold transition-colors shrink-0 ${
                  autoVjLayouts ? 'bg-nar-green text-black' : 'bg-surface-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                Layouts
              </button>
              <span className="text-xs text-slate-600 flex-1">picks split / PiP for two-ups</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => setBeatFx(!beatFx)}
              title="Beat-pulse vignette + punch-zoom on the program output"
              className={`text-xs w-[88px] py-1 rounded font-bold transition-colors shrink-0 ${
                beatFx ? 'bg-nar-green text-black' : 'bg-surface-800 text-slate-500 hover:text-slate-300'
              }`}
            >
              Beat FX
            </button>
            <span className="text-xs text-slate-600 flex-1">pulse + punch on beats</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setDropToViz(!dropToViz)}
              title="Auto-cut to the music visualizer when the track drops, back when it calms"
              className={`text-xs w-[88px] py-1 rounded font-bold transition-colors shrink-0 ${
                dropToViz ? 'bg-nar-green text-black' : 'bg-surface-800 text-slate-500 hover:text-slate-300'
              }`}
            >
              Drop → Viz
            </button>
            <span className="text-xs text-slate-600 flex-1">visualizer on the drop</span>
          </div>
        </div>
      )}

      {/* OBS scene list — quick cut, OBS engine only */}
      {engineId === 'obs' && obsScenes.length > 0 && (
        <div className="mt-1">
          <span className="text-xs text-slate-600 uppercase tracking-wider">OBS Scenes</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {obsScenes.map(scene => (
              <button
                key={scene}
                onClick={() => cut(scene)}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                  programSource === scene
                    ? 'bg-nar-red text-white'
                    : 'bg-surface-800 hover:bg-surface-700 text-slate-500 hover:text-slate-300'
                }`}
              >
                {scene}
              </button>
            ))}
          </div>
        </div>
      )}

      {engineId === 'obs' && (
        <span className="text-xs text-slate-700 pt-1">NDI in/out handled by OBS (obs-ndi plugin).</span>
      )}
    </div>
  )
}
