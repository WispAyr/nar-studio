import { useEngine } from '../../engine/EngineProvider'
import { useCameraStreams } from '../../camera/CameraStreamProvider'
import type { EngineId } from '../../engine/types'

const ENGINES: { id: EngineId; label: string }[] = [
  { id: 'builtin', label: 'Built-in' },
  { id: 'obs', label: 'OBS' },
]

export function StatusBar() {
  const { engineId, setEngineId, connected, recording, streaming } = useEngine()
  const { sources } = useCameraStreams()
  const liveCams = sources.filter(s => s.hasSignal).length

  return (
    <div className="flex items-center gap-4 px-4 h-6 bg-surface-950 border-t border-surface-800 shrink-0 text-xs">
      {/* Engine selector */}
      <div className="flex items-center gap-1">
        <span className="text-slate-600 uppercase tracking-wider">Engine</span>
        {ENGINES.map(e => (
          <button
            key={e.id}
            onClick={() => setEngineId(e.id)}
            className={`px-1.5 rounded transition-colors ${
              engineId === e.id
                ? 'bg-nar-blue text-white'
                : 'bg-surface-800 text-slate-500 hover:text-slate-300'
            }`}
          >
            {e.label}
          </button>
        ))}
      </div>

      {/* Engine status */}
      <div className="flex items-center gap-1.5">
        <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-nar-green' : 'bg-nar-amber'}`} />
        <span className="text-slate-500">
          {engineId === 'builtin'
            ? 'Built-in engine'
            : connected ? 'OBS Connected' : 'OBS Disconnected'}
        </span>
      </div>

      {/* Cameras */}
      <div className="flex items-center gap-1.5">
        <span className="text-slate-500">{liveCams}/4 cameras</span>
      </div>

      {/* States */}
      {recording && (
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-nar-red animate-pulse" />
          <span className="text-nar-red font-bold">REC</span>
        </div>
      )}
      {streaming && (
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-nar-red animate-pulse" />
          <span className="text-nar-red font-bold">LIVE</span>
        </div>
      )}

      <div className="flex-1" />
      <span className="text-slate-700">NAR Studio Director v1.0</span>
    </div>
  )
}
