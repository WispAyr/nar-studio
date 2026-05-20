import { useOBS } from '../../hooks/useOBS'
import { useCameras } from '../../hooks/useCameras'

const SCENE_MAP = ['CAM1', 'CAM2', 'CAM3', 'CAM4']

const OUTPUTS = [
  { id: 'program', label: 'PGM', color: 'border-nar-red text-nar-red' },
  { id: 'ndi-out', label: 'NDI', color: 'border-nar-blue text-nar-blue' },
  { id: 'stream', label: 'RTMP', color: 'border-nar-amber text-nar-amber' },
]

export function VideoRouter() {
  const { programScene, scenes, cutTo } = useOBS()
  const { cameras } = useCameras()

  // All available sources: 4 cameras + any NDI sources from OBS scenes
  const sources = SCENE_MAP.map((scene, i) => ({
    id: scene,
    label: cameras[i]?.label ?? `Camera ${i + 1}`,
    connected: cameras[i]?.connected ?? false,
  }))

  return (
    <div className="flex flex-col gap-2 p-3 h-full overflow-y-auto">
      <span className="text-xs text-slate-500 uppercase tracking-wider">Video Router</span>

      {/* Router matrix */}
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
              <tr key={src.id} className="border-b border-surface-800">
                <td className="py-1 pr-2">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${src.connected ? 'bg-nar-green' : 'bg-surface-600'}`} />
                    <span className={src.connected ? 'text-slate-300' : 'text-slate-600'}>{src.label}</span>
                  </div>
                </td>

                {/* PGM routing */}
                <td className="py-1 px-2 text-center">
                  <button
                    onClick={() => cutTo(src.id)}
                    className={`w-6 h-6 rounded transition-colors ${
                      programScene === src.id
                        ? 'bg-nar-red text-white'
                        : 'bg-surface-800 hover:bg-surface-700 text-slate-600 hover:text-slate-300'
                    }`}
                  >
                    {programScene === src.id ? '●' : '○'}
                  </button>
                </td>

                {/* NDI — visual indicator, actual routing via OBS NDI plugin */}
                <td className="py-1 px-2 text-center">
                  <div className="w-6 h-6 rounded bg-surface-800 flex items-center justify-center text-slate-700 mx-auto">
                    ○
                  </div>
                </td>

                {/* RTMP follows PGM */}
                <td className="py-1 px-2 text-center">
                  <div className={`w-6 h-6 rounded flex items-center justify-center mx-auto ${
                    programScene === src.id ? 'text-nar-amber' : 'text-slate-700'
                  }`}>
                    {programScene === src.id ? '●' : '○'}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* OBS scene list — quick cut */}
      {scenes.length > 0 && (
        <div className="mt-1">
          <span className="text-xs text-slate-600 uppercase tracking-wider">OBS Scenes</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {scenes.map(scene => (
              <button
                key={scene}
                onClick={() => cutTo(scene)}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                  programScene === scene
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
    </div>
  )
}
