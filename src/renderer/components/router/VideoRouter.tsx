import { useEngine } from '../../engine/EngineProvider'

const OUTPUTS = [
  { id: 'program', label: 'PGM', color: 'border-nar-red text-nar-red' },
  { id: 'stream', label: 'RTMP', color: 'border-nar-amber text-nar-amber' },
]

export function VideoRouter() {
  const { engineId, programSource, sources, obsScenes, cut } = useEngine()

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
            {sources.map(src => (
              <tr key={src.key} className="border-b border-surface-800">
                <td className="py-1 pr-2">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${src.hasSignal ? 'bg-nar-green' : 'bg-surface-600'}`} />
                    <span className={src.hasSignal ? 'text-slate-300' : 'text-slate-600'}>{src.label}</span>
                  </div>
                </td>

                {/* PGM routing */}
                <td className="py-1 px-2 text-center">
                  <button
                    onClick={() => cut(src.key)}
                    className={`w-6 h-6 rounded transition-colors ${
                      programSource === src.key
                        ? 'bg-nar-red text-white'
                        : 'bg-surface-800 hover:bg-surface-700 text-slate-600 hover:text-slate-300'
                    }`}
                  >
                    {programSource === src.key ? '●' : '○'}
                  </button>
                </td>

                {/* RTMP follows PGM */}
                <td className="py-1 px-2 text-center">
                  <div className={`w-6 h-6 rounded flex items-center justify-center mx-auto ${
                    programSource === src.key ? 'text-nar-amber' : 'text-slate-700'
                  }`}>
                    {programSource === src.key ? '●' : '○'}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
