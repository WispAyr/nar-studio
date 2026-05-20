import { useOBS } from '../../hooks/useOBS'
import { useCameras } from '../../hooks/useCameras'

export function StatusBar() {
  const { connected, streaming, recording } = useOBS()
  const { cameras } = useCameras()
  const connectedCams = cameras.filter(c => c.connected).length

  return (
    <div className="flex items-center gap-4 px-4 h-6 bg-surface-950 border-t border-surface-800 shrink-0 text-xs">
      {/* OBS */}
      <div className="flex items-center gap-1.5">
        <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-nar-green' : 'bg-surface-600'}`} />
        <span className="text-slate-500">OBS {connected ? 'Connected' : 'Disconnected'}</span>
      </div>

      {/* Cameras */}
      <div className="flex items-center gap-1.5">
        <span className="text-slate-500">{connectedCams}/4 cameras</span>
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
