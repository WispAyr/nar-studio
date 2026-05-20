import { useEngine } from '../../engine/EngineProvider'
import type { LayoutType } from '../../engine/types'

const OUTPUTS = [
  { id: 'program', label: 'PGM', color: 'border-nar-red text-nar-red' },
  { id: 'stream', label: 'RTMP', color: 'border-nar-amber text-nar-amber' },
]

const LAYOUTS: { id: LayoutType; label: string }[] = [
  { id: 'solo', label: 'Solo' },
  { id: 'split', label: 'Split' },
  { id: 'pip', label: 'PiP' },
]

const SLOT_LABELS: Record<LayoutType, string[]> = {
  solo: ['Program'],
  split: ['Left', 'Right'],
  pip: ['Main', 'Inset'],
}

export function VideoRouter() {
  const {
    engineId, programSource, programCams, sources, obsScenes, cut,
    transition, setTransition, layout, setLayout, programSlots, activeSlot, setActiveSlot,
  } = useEngine()

  const inProgram = (key: string) => programCams.includes(Number(key.slice(3)))

  return (
    <div className="flex flex-col gap-2 p-3 h-full overflow-y-auto">
      <span className="text-xs text-slate-500 uppercase tracking-wider">Video Router</span>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left text-slate-600 pb-1 pr-2 font-normal">Source</th>
              {OUTPUTS.map(out => (
                <th key={out.id} className={`text-center pb-1 px-2 font-bold border-b ${out.color}`}>
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
            {(['cut', 'fade', 'dip'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTransition(t)}
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
