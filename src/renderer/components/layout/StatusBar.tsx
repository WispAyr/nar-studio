import { useEffect, useState } from 'react'
import { useEngine } from '../../engine/EngineProvider'
import { useCameraStreams } from '../../camera/CameraStreamProvider'
import { useViz } from '../../viz/VizProvider'
import type { EngineId } from '../../engine/types'

function FpsIndicator() {
  const { levelsRef } = useViz()
  const [fps, setFps] = useState(60)
  useEffect(() => {
    const id = window.setInterval(() => {
      const v = levelsRef.current.fps
      setFps(prev => Math.abs(prev - v) < 1 ? prev : v)
    }, 500)
    return () => window.clearInterval(id)
  }, [levelsRef])
  const colour = fps < 45 ? 'text-nar-red' : fps < 56 ? 'text-nar-amber' : 'text-slate-400'
  return (
    <div className="flex items-center gap-1.5 shrink-0" title="Viz pipeline frame rate">
      <span className="text-slate-600 uppercase tracking-wider">FPS</span>
      <span className={`tabular-nums font-bold ${colour}`}>{Math.round(fps)}</span>
    </div>
  )
}

const ENGINES: { id: EngineId; label: string }[] = [
  { id: 'builtin', label: 'Built-in' },
  { id: 'obs', label: 'OBS' },
]

export function StatusBar() {
  const { engineId, setEngineId, connected, recording, streamStatus } = useEngine()
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
      {streamStatus !== 'idle' && (
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${
            streamStatus === 'reconnecting' ? 'bg-nar-amber' : 'bg-nar-red'
          }`} />
          <span className={`font-bold ${
            streamStatus === 'reconnecting' ? 'text-nar-amber' : 'text-nar-red'
          }`}>
            {streamStatus === 'live' ? 'LIVE'
              : streamStatus === 'reconnecting' ? 'RECONNECTING'
              : 'STREAM LOST'}
          </span>
        </div>
      )}

      <div className="flex-1" />
      <FpsIndicator />
      <span className="text-slate-700">NAR Studio Director v1.0</span>
    </div>
  )
}
